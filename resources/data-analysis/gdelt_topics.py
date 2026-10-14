"""Group real GDELT headlines into specific, related news stories."""
from collections import defaultdict
import re
from urllib.parse import unquote, urlsplit


def article_label(article):
    if article.get('title', '').strip():
        return article['title'].strip(), 'headline'
    path = unquote(urlsplit(article['url']).path).strip('/').split('/')[-1]
    words = re.sub(r'[-_]+', ' ', path)
    return (words[:200] if len(words) > 15 else 'Open Article'), 'url'


def _subject_label(story):
    """Use distinctive headline phrases when no named person labels a topic."""
    import numpy as np
    from sklearn.feature_extraction.text import TfidfVectorizer
    titles = list(dict.fromkeys(a['title'] for a in story['articles'] if a.get('title')))
    from collections import Counter
    from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS
    organizations = Counter()
    generic = {'national', 'united', 'department', 'supreme', 'american', 'government', 'university'}
    for name in {n.strip() for a in story['articles'] for n in a.get('organizations', '').split(';') if n.strip()}:
        first = name.split()[0].casefold()
        if len(first) < 5 or first in generic:
            continue
        label = name
        phrase = name.casefold()
        # A campus headline may name Cornell without writing University.
        if 'university' in name.split()[1:2]:
            label = ' '.join(name.split()[:2])
            phrase = first
        count = sum(bool(re.search(r'(?<!\w)' + re.escape(phrase) + r'(?!\w)', title.casefold())) for title in titles)
        if count and count >= len(titles) / 2:
            organizations[label] = count
    if organizations:
        return sorted(organizations, key=lambda n: (-organizations[n], -len(n.split()), n))[0].title()
    filler = {'calls','call','deeply','disturbing','says','said','exposes','expose','attempt','new','unknown','future','fuels','fuel','leaves','leave','continues','continue','set','hear','dead','dies','die','alleged','considers','names','chief','president','national','world','news','today','amid','latest'}
    try:
        words = TfidfVectorizer(stop_words=sorted(set(ENGLISH_STOP_WORDS) | filler), ngram_range=(1, 2), token_pattern=r'(?u)\b[a-zA-Z][a-zA-Z]+\b')
        matrix = words.fit_transform(titles)
        terms = words.get_feature_names_out()
        weights = np.asarray(matrix.mean(axis=0)).ravel()
        order = sorted(range(len(terms)), key=lambda i: (-weights[i] * (1.15 if ' ' in terms[i] else 1), terms[i]))
        selected = []
        used = set()
        for i in order:
            pieces = set(terms[i].split())
            if used & pieces:
                continue
            selected.append(terms[i].title())
            used.update(pieces)
            if len(selected) == 2:
                break
        return ' / '.join(selected) or story['name']
    except ValueError:
        return story['name']


def build_topics(payload, vectors=None):
    """Cluster headline meaning; supplied vectors align with input article rows.

    Missing headlines stay in Other News. Exact normalized headlines share a
    group even when supplied features differ. Tags never determine membership.
    """
    import numpy as np
    from sklearn.cluster import AgglomerativeClustering

    originals = payload.get('articles', [])
    articles = []
    title_positions = []
    input_positions = []
    seen = set()
    for input_position, original in enumerate(originals):
        url = original.get('url', '')
        if not isinstance(url, str) or any(c.isspace() or ord(c) < 32 for c in url) or '\\' in url:
            continue
        try:
            parsed = urlsplit(url)
            if parsed.scheme not in ('http', 'https') or not parsed.hostname or url in seen:
                continue
            if parsed.username is not None or parsed.password is not None:
                continue
            parsed.port
        except ValueError:
            continue
        seen.add(url)
        article = dict(original)
        article['title'] = original.get('title') if isinstance(original.get('title'), str) else ''
        article['source'] = original.get('source') or parsed.hostname
        article['label'], article['label_kind'] = article_label(article)
        if article['title'].strip():
            title_positions.append(len(articles))
            input_positions.append(input_position)
        articles.append(article)

    titles = [articles[position]['title'].strip() for position in title_positions]
    if vectors is None:
        if titles:
            from semantic_analysis import encode_titles
            features = encode_titles(titles)
        else:
            features = np.empty((0, 0))
    else:
        features = np.asarray(vectors, dtype=float)
        if features.ndim != 2 or features.shape[0] != len(originals):
            raise ValueError('Headline vectors must have one row per input article.')
        features = features[input_positions]

    groups = defaultdict(list)
    centers = []
    if titles:
        features = np.asarray(features, dtype=float)
        if features.ndim != 2 or features.shape[0] != len(titles) or features.shape[1] == 0 or not np.isfinite(features).all():
            raise ValueError('Headline vectors must be finite, nonempty rows aligned with titles.')
        norms = np.linalg.norm(features, axis=1)
        if np.any(norms == 0):
            raise ValueError('Headline vectors must have nonzero length.')
        features = features / norms[:, None]
        exact = defaultdict(list)
        for position, title in enumerate(titles):
            normalized = ' '.join(re.findall(r'\w+', title.casefold())) or title.casefold()
            exact[normalized].append(position)
        headline_groups = list(exact.values())
        # Use one vector per normalized headline so syndicated copies cannot
        # pull otherwise unrelated stories into the same cluster.
        unique_features = features[[positions[0] for positions in headline_groups]]
        labels = (AgglomerativeClustering(n_clusters=None, metric='cosine', linkage='average',
                  distance_threshold=0.40).fit_predict(unique_features)
                  if len(unique_features) > 1 else np.zeros(len(unique_features), dtype=int))
        for label, positions in zip(labels, headline_groups):
            groups[int(label)].extend(positions)
        centers = features

    topics = []
    assigned = set()
    for positions in groups.values():
        if len(positions) < 2:
            continue
        center = centers[positions].mean(axis=0)
        representative = positions[int(np.argmax(centers[positions] @ center))]
        matching = [articles[title_positions[position]] for position in sorted(positions)]
        assigned.update(article['url'] for article in matching)
        topics.append(dict(name=titles[representative],
            summary='Articles about the same or a closely related story.',
            article_count=len(matching), source_count=len({article['source'] for article in matching}),
            articles=matching))
    from gdelt_topic_entities import umbrella_topics
    topics = umbrella_topics(topics, articles)
    for topic in topics:
        if not topic.get('entity'):
            topic['name'] = _subject_label(topic)
            topic['summary'] = 'Related coverage of this subject.'
        topic['story_count'] = len(topic.get('stories', []))
    topics.sort(key=lambda topic: (-topic['source_count'], -topic['article_count'], topic['name']))
    assigned = {article['url'] for topic in topics for article in topic['articles']}
    other_articles = [article for article in articles if article['url'] not in assigned]
    return dict(fetched_at=payload['fetched_at'], country_note=payload.get('country_note', ''),
        article_count=len(articles), source_count=len({article['source'] for article in articles}),
        topics=topics, unassigned_count=len(other_articles), other_articles=other_articles,
        input_article_count=payload.get('input_article_count', len(articles)),
        excluded_articles=payload.get('excluded_articles', []))
