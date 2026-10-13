"""Describe sampled headline topics with fixed historical labels and collection controls."""
from urllib.parse import urlsplit

import numpy as np
import pandas as pd
from sklearn.cluster import MiniBatchKMeans
from sklearn.feature_extraction.text import TfidfVectorizer


GENERIC_TERMS = {'news', 'new', 'says', 'said', 'year', 'years', 'people', 'today',
                 'report', 'reports', 'reddit', 'just', 'like', 'will', 'time', 'world'}


def _number(value):
    return float(value) if pd.notna(value) and np.isfinite(value) else None


def _share(count, total):
    return 100.0 * count / total if total else None


def _difference(current, previous):
    return current - previous if current is not None and previous is not None else None


def _safe_url(value):
    value = '' if pd.isna(value) else str(value)
    try:
        parsed = urlsplit(value)
        return value if parsed.scheme in ('https', 'http') and parsed.netloc else None
    except ValueError:
        return None


def _examples(posts, positions, vectors, center, limit=3):
    if not len(positions):
        return []
    distances = np.sum((vectors[positions] - center) ** 2, axis=1)
    ordered = positions[np.argsort(distances, kind='stable')]
    rows, seen = [], set()
    for index in ordered:
        post = posts.iloc[index]
        title = str(post.title)
        if title in seen:
            continue
        seen.add(title)
        rows.append({'title': title, 'date': post.created_at.isoformat(),
                     'source': str(post.get('domain', '')), 'sub': str(post['sub']),
                     'votes': _number(post.get('upvoteCount', np.nan)),
                     'comments': _number(post.get('commentCount', np.nan)),
                     'url': _safe_url(post.get('url', '')),
                     'created_at': post.created_at.isoformat(), 'domain': str(post.get('domain', '')),
                     'upvoteCount': _number(post.get('upvoteCount', np.nan)),
                     'commentCount': _number(post.get('commentCount', np.nan))})
        if len(rows) == limit:
            break
    return rows


def _topic_names(posts, training, labels, topic_count):
    documents = [' '.join(posts.loc[training & (labels == topic), 'title'].astype(str))
                 for topic in range(topic_count)]
    try:
        words = TfidfVectorizer(stop_words='english', max_features=12000,
                               token_pattern=r'(?u)\b[a-zA-Z][a-zA-Z]+\b')
        scores = words.fit_transform(documents).toarray()
        terms = words.get_feature_names_out()
        # Terms present in most topics are collection boilerplate, not useful labels.
        coverage = np.count_nonzero(scores, axis=0)
        allowed = np.array([term not in GENERIC_TERMS for term in terms])
        if topic_count >= 3:
            allowed &= coverage < max(2, int(np.ceil(topic_count * .75)))
        scores[:, ~allowed] = 0
        keywords = [[str(terms[index]) for index in np.argsort(-row, kind='stable')[:6]
                     if row[index] > 0] for row in scores]
    except ValueError:
        keywords = [[] for _ in documents]
    return [((' / '.join(word.title() for word in terms[:3]) or f'Topic {topic + 1}'), terms)
            for topic, terms in enumerate(keywords)]


def _reaction(posts, current, previous):
    ages = pd.to_numeric(posts.get('observation_age_hours', pd.Series(np.nan, index=posts.index)), errors='coerce')
    age_match = ages.between(12, 48)
    result = {}
    for field, column in [('votes', 'upvoteCount'), ('comments', 'commentCount')]:
        values = pd.to_numeric(posts.get(column, pd.Series(np.nan, index=posts.index)), errors='coerce')
        valid = age_match & values.notna() & np.isfinite(values)
        masks = {'current': current & valid, 'previous': previous & valid}
        for period, mask in masks.items():
            result[f'{period}_{field}_count'] = int(mask.sum())
        available = all(result[f'{period}_{field}_count'] >= 10 for period in masks)
        result[f'{field}_available'] = available
        for period, mask in masks.items():
            result[f'{period}_median_{field}'] = _number(values[mask].median()) if available else None
        result[f'{field}_change'] = _difference(result[f'current_median_{field}'], result[f'previous_median_{field}'])
    result.update(available=result['votes_available'],
                  current_count=result['current_votes_count'], previous_count=result['previous_votes_count'],
                  note='Each median needs 10 valid posts per period, observed at 12–48 hours. Missing measurements stay unavailable.')
    ratios = pd.to_numeric(posts.get('upvote_ratio', pd.Series(np.nan, index=posts.index)), errors='coerce')
    ratio_masks = {'current': current & age_match & ratios.between(0, 1),
                   'previous': previous & age_match & ratios.between(0, 1)}
    ratio_available = all(mask.sum() >= 10 for mask in ratio_masks.values())
    for period, mask in ratio_masks.items():
        result[f'{period}_median_upvote_ratio'] = _number(ratios[mask].median()) if ratio_available else None
    return result


def analyze_topics(posts, vectors, window_days=7, topic_count=40, seed=123456):
    """Return JSON-safe topic rows globally and within each sampled subreddit."""
    if window_days <= 0 or int(topic_count) != topic_count or topic_count < 1:
        raise ValueError('Window days and topic count must be positive.')
    posts = posts.reset_index(drop=True).copy()
    vectors = np.asarray(vectors, dtype=np.float32)
    if vectors.ndim != 2 or vectors.shape != (len(posts), 384) or not np.isfinite(vectors).all():
        raise ValueError('Vectors must contain one finite 384-dimensional row per post.')
    if posts.empty:
        return {'sample': {'posts': 0, 'subreddits': 0, 'training_posts': 0}, 'periods': {},
                'topics': [], 'subreddits': [], 'adjustment': {'available': False,
                'common_subreddits': [], 'previous_weights': {}}, 'method': {'topic_count': 0, 'status': 'no_posts', 'notes': ['No posts are available.']}}
    posts['created_at'] = pd.to_datetime(posts['created_at'], utc=True, errors='coerce')
    if posts.created_at.isna().any():
        raise ValueError('Every post needs a valid creation time.')
    posts['sub'] = posts['sub'].fillna('Unknown').astype(str)
    input_count = len(posts)
    dedup_keys = pd.DataFrame({'sub': posts['sub'], 'title': posts['title'].fillna('').astype(str).str.lower().str.replace(r'\s+', ' ', regex=True).str.strip()})
    retained = ~dedup_keys.duplicated()
    posts = posts.loc[retained].reset_index(drop=True)
    vectors = vectors[retained.to_numpy()]
    norms = np.linalg.norm(vectors, axis=1)
    if np.any(norms == 0):
        raise ValueError('Headline vectors must have nonzero length.')
    if not np.allclose(norms, 1, atol=1e-5):
        vectors = vectors / norms[:, None]
    latest = posts.created_at.max()
    cutoff = latest - pd.Timedelta(days=window_days)
    previous_start = cutoff - pd.Timedelta(days=window_days)
    training = (posts.created_at < cutoff).to_numpy()
    sample = {'posts': len(posts), 'input_posts': input_count, 'duplicate_posts': input_count - len(posts), 'subreddits': int(posts['sub'].nunique()),
              'earliest_created_at': posts.created_at.min().isoformat(),
              'latest_created_at': latest.isoformat(), 'training_posts': int(training.sum())}
    method = {'window_days': window_days, 'history_weeks': 12, 'deduplication': 'One normalized headline per subreddit; first observation retained.',
              'training_cutoff': cutoff.isoformat(), 'seed': seed,
              'stable_topic_minimum_per_period': 10, 'reaction_age_hours': [12, 48],
              'notes': [
                  'Topics and keyword labels come from older headlines. Recent posts use those same labels.',
                  'Shares describe collected posts, not all Reddit activity. Collection gaps can affect results.',
                  'Adjusted shares hold the previous subreddit mix fixed where both periods have enough posts.',
                  'These are observed changes. They do not predict future popularity or explain causes.',
                  'Weekly history shows raw collected-post shares. Adjusted comparisons apply only to the two recent periods.']}
    current = ((posts.created_at >= cutoff) & (posts.created_at <= latest)).to_numpy()
    previous = ((posts.created_at >= previous_start) & (posts.created_at < cutoff)).to_numpy()
    def periods(scope):
        return {'current': {'start': cutoff.isoformat(), 'end': latest.isoformat(), 'count': int((scope & current).sum())},
                'previous': {'start': previous_start.isoformat(), 'end': cutoff.isoformat(), 'count': int((scope & previous).sum())}}
    all_posts = np.ones(len(posts), dtype=bool)
    if not training.any():
        method.update(topic_count=0, status='insufficient_history')
        method['notes'].append('Older posts are required to discover topics before the comparison window.')
        return {'sample': sample, 'periods': periods(all_posts), 'topics': [], 'subreddits': [],
                'adjustment': {'available': False, 'common_subreddits': [], 'previous_weights': {}}, 'method': method}
    count = min(int(topic_count), int(training.sum()))
    model = MiniBatchKMeans(n_clusters=count, random_state=seed, n_init=3, batch_size=1024)
    model.fit(vectors[training])
    labels = model.predict(vectors)
    names = _topic_names(posts, training, labels, count)
    method.update(topic_count=count, status='complete')
    scopes = {sub: (posts['sub'] == sub).to_numpy() for sub in sorted(posts['sub'].unique())}
    common = {sub: scope for sub, scope in scopes.items()
              if (scope & current).sum() >= 20 and (scope & previous).sum() >= 20}
    prior_total = sum(int((scope & previous).sum()) for scope in common.values())
    weights = {sub: int((scope & previous).sum()) / prior_total for sub, scope in common.items()}
    adjustment = {'available': bool(common), 'common_subreddits': list(common), 'previous_weights': weights,
                  'minimum_posts_per_period': 20,
                  'excluded_subreddits': [sub for sub in scopes if sub not in common],
                  'current_coverage_pct': _share(sum(int((scope & current).sum()) for scope in common.values()), int(current.sum())),
                  'previous_coverage_pct': _share(prior_total, int(previous.sum()))}
    history_bins = []
    for week in range(12):
        start = latest - pd.Timedelta(weeks=12 - week)
        end = start + pd.Timedelta(weeks=1)
        mask = ((posts.created_at >= start) & ((posts.created_at <= end) if week == 11 else (posts.created_at < end))).to_numpy()
        history_bins.append((start.isoformat(), end.isoformat(), mask))
    def rows(scope, adjusted=False):
        totals = periods(scope)
        result = []
        for topic, (name, keywords) in enumerate(names):
            selected = scope & (labels == topic)
            now, before = selected & current, selected & previous
            n, p = int(now.sum()), int(before.sum())
            ns, ps = _share(n, totals['current']['count']), _share(p, totals['previous']['count'])
            status = ('emerging' if n and not p else 'disappearing' if p and not n
                      else 'no_recent_posts' if not n and not p else 'compared')
            metrics = {'current_count': n, 'previous_count': p, 'current_share_pct': ns,
                       'previous_share_pct': ps, 'share_change_pp': _difference(ns, ps),
                       'growth_pct': 100.0 * (ns - ps) / ps if ps and ns is not None else None,
                       'count_growth_pct': 100.0 * (n - p) / p if p else None,
                       'status': status, 'stable_comparison': n >= 10 and p >= 10,
                       'reaction': _reaction(posts, now, before)}
            for period, mask in [('current', current), ('previous', previous)]:
                metrics[f'adjusted_{period}_share_pct'] = (sum(weights[sub] * _share(int((selected & mask & sub_scope).sum()),
                      int((mask & sub_scope).sum())) for sub, sub_scope in common.items()) if adjusted and common else None)
            metrics['adjusted_share_change_pp'] = _difference(metrics['adjusted_current_share_pct'], metrics['adjusted_previous_share_pct'])
            history = [{'start': start, 'end': end, 'count': int((selected & mask).sum()),
                        'total': int((scope & mask).sum()), 'share_pct': _share(int((selected & mask).sum()), int((scope & mask).sum()))}
                       for start, end, mask in history_bins]
            center = model.cluster_centers_[topic]
            examples = {period: _examples(posts, np.flatnonzero(mask), vectors, center)
                        for period, mask in [('current', now), ('previous', before), ('representative', selected & training)]}
            result.append({'id': topic, 'name': name, 'keywords': keywords, 'metrics': metrics,
                           'history': history, 'examples': examples})
        return result
    return {'sample': sample, 'periods': periods(all_posts), 'topics': rows(all_posts, True),
            'subreddits': [{'name': sub, 'periods': periods(scope), 'topics': rows(scope)} for sub, scope in scopes.items()],
            'adjustment': adjustment, 'method': method}
