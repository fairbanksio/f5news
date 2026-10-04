"""Small, bounded headline experiments. Similarity suggests leads, not verified stories."""
import numpy as np
import pandas as pd
from sklearn.cluster import MiniBatchKMeans
from sklearn.feature_extraction.text import TfidfVectorizer

RECENT_LIMIT = 2000
FEED_LIMIT = 200


def _section(identifier, title, summary, tables=None, metrics=None, enough=True):
    return dict(id=identifier, title=title, summary=summary, tables=tables or [],
                metrics=metrics or {}, status="complete" if enough else "insufficient_data")


def _headline(posts, index):
    row = posts.iloc[int(index)]
    return {"Headline": str(row.title), "Subreddit": str(row["sub"]),
            "Source": str(row.domain), "Saved Votes": int(row.upvoteCount),
            "URL": str(row.url)}


def _recent(posts, days, limit):
    newest = posts.created_at.max()
    return posts.index[posts.created_at > newest - pd.Timedelta(days=days)].to_numpy()[-limit:]


def group_same_story(posts, vectors):
    indices = _recent(posts, 7, RECENT_LIMIT)
    groups, used = [], set()
    # Each member must match every other member, so A-B-C chains cannot merge.
    similarity = vectors[indices] @ vectors[indices].T
    times = posts.created_at.iloc[indices]
    hours = (times - times.min()).dt.total_seconds().to_numpy() / 3600
    for local in range(len(indices) - 1, -1, -1):
        if local in used:
            continue
        members = [local]
        candidates = np.flatnonzero((similarity[local] >= .82) &
                                     (np.abs(hours - hours[local]) <= 48))
        candidates = sorted(candidates, key=lambda other: (-float(similarity[local, other]), int(other)))
        for other in candidates:
            if other in used or other in members:
                continue
            if (np.all(similarity[other, members] >= .82) and
                    np.all(np.abs(hours[other] - hours[members]) <= 48)):
                members.append(int(other))
        if len(members) > 1:
            used.update(members)
            groups.append(members)
    tables = []
    for number, members in enumerate(groups[:3], 1):
        rows = []
        for member in members[:4]:
            row = _headline(posts, indices[member])
            row["Headline Match (%)"] = round(100 * float(np.clip(similarity[member, members[0]], 0, 1)), 1)
            rows.append(row)
        tables.append({"title": f"Suggested Story Group {number}", "rows": rows})
    return _section("group_same_story", "Group the Same Story",
        f"Found {len(groups):,} suggested groups among {len(indices):,} headlines from the seven days ending with the latest saved post. Grouped headlines appeared within 48 hours. Read the examples to check whether they cover the same event.",
        tables, {"candidates": len(indices), "candidate_limit": RECENT_LIMIT,
                 "proposed_groups": len(groups), "cosine_threshold": .82,
                 "maximum_group_span_hours": 48, "verified_groups": 0}, len(indices) >= 2)


def _topics(posts, vectors, seed):
    cutoff = posts.created_at.max() - pd.Timedelta(days=7)
    training = posts.index[posts.created_at <= cutoff].to_numpy()
    if len(training) < 20:
        return None, None, {}, len(training)
    count = min(12, max(2, len(training) // 20))
    model = MiniBatchKMeans(n_clusters=count, random_state=seed, n_init=3,
                           batch_size=512, max_iter=100)
    model.fit(vectors[training])
    labels = model.predict(vectors)
    names = {}
    try:
        words = TfidfVectorizer(stop_words="english", max_features=3000,
                                ngram_range=(1, 2)).fit(posts.title.iloc[training])
        text = words.transform(posts.title.iloc[training])
        vocabulary = words.get_feature_names_out()
        for label in range(count):
            positions = np.flatnonzero(labels[training] == label)
            if len(positions):
                weights = np.asarray(text[positions].mean(axis=0)).ravel()
                best = np.argsort(-weights, kind="stable")[:3]
                names[label] = ", ".join(vocabulary[best][weights[best] > 0])
    except ValueError:
        pass
    names = {label: names.get(label, f"Topic {label + 1}") for label in range(count)}
    return model, labels, names, len(training)


def spot_growing_topics(posts, vectors, labels, names, training_count):
    end = posts.created_at.max()
    recent = posts.index[posts.created_at > end - pd.Timedelta(days=7)].to_numpy()
    previous = posts.index[(posts.created_at > end - pd.Timedelta(days=14)) &
                           (posts.created_at <= end - pd.Timedelta(days=7))].to_numpy()
    span_days = float((end - posts.created_at.min()).total_seconds() / 86400)
    metrics = {"previous_week_posts": len(previous), "recent_week_posts": len(recent),
               "sample_span_days": round(span_days, 2), "topic_training_posts": training_count,
               "minimum_posts_per_week": 20, "minimum_topic_posts_per_week": 3,
               "coverage": "Saved sample; collection frequency and subreddit coverage may differ"}
    if labels is None or len(previous) < 20 or len(recent) < 20 or span_days < 14:
        return _section("spot_growing_topics", "Spot Growing Topics",
            "Two full weeks with at least 20 saved posts each are needed. This sample cannot support a weekly topic comparison yet.",
            metrics=metrics, enough=False)
    rows = []
    for label, name in names.items():
        before = int(np.count_nonzero(labels[previous] == label))
        after = int(np.count_nonzero(labels[recent] == label))
        if min(before, after) < 3:
            continue
        before_share, after_share = before / len(previous), after / len(recent)
        examples = recent[labels[recent] == label]
        history = posts.index[(labels == label) & (posts.created_at <= end - pd.Timedelta(days=7))].to_numpy()
        center = vectors[history].mean(axis=0)
        representative = int(examples[np.argmax(vectors[examples] @ center)])
        rows.append({"Topic Keywords": name, "Previous Posts": before, "Recent Posts": after,
                     "Previous Share (%)": round(100 * before_share, 2),
                     "Recent Share (%)": round(100 * after_share, 2),
                     "Change (Percentage Points)": round(100 * (after_share - before_share), 2),
                     "Example Headline": str(posts.title.iloc[representative])})
    rows.sort(key=lambda row: (-row["Change (Percentage Points)"], row["Topic Keywords"]))
    return _section("spot_growing_topics", "Spot Growing Topics",
        f"Compared {len(rows)} topics across the two weeks ending with the latest saved post. The table shows each topic's share of saved headlines. Keywords label broad topics automatically; changes describe this sample rather than all Reddit activity.",
        [{"title": "Topics Ranked by Change", "rows": rows[:10]}], metrics, bool(rows))


def find_similar_stories(posts, vectors):
    queries = []
    seen = set()
    for index in range(len(posts) - 1, -1, -1):
        title = str(posts.title.iloc[index]).strip().casefold()
        if title not in seen:
            queries.append(index)
            seen.add(title)
        if len(queries) == 3:
            break
    tables = []
    matches = 0
    for query in queries:
        row = posts.iloc[query]
        older = posts.index[(posts.created_at <= row.created_at - pd.Timedelta(hours=24)) &
                            (posts.title.str.strip().str.casefold() != str(row.title).strip().casefold())].to_numpy()
        same_sub = older[posts["sub"].iloc[older].to_numpy() == row["sub"]]
        candidates = same_sub if len(same_sub) >= 3 else older
        scores = vectors[candidates] @ vectors[query]
        ranked = np.argsort(-scores, kind="stable")
        rows, included = [], set()
        for position in ranked:
            index = int(candidates[position])
            key = str(posts.title.iloc[index]).strip().casefold()
            if key in included:
                continue
            included.add(key)
            result = _headline(posts, index)
            result["Headline Match (%)"] = round(100 * float(np.clip(scores[position], 0, 1)), 1)
            result["Hours Older"] = round(float((row.created_at - posts.created_at.iloc[index]).total_seconds() / 3600), 1)
            rows.append(result)
            if len(rows) == 3:
                break
        matches += len(rows)
        tables.append({"title": f"Earlier Matches for: {row.title}", "rows": rows})
    return _section("find_similar_stories", "Find Similar Stories",
        f"Found {matches} earlier matches for {len(queries)} latest saved headlines. Every match is at least 24 hours older. Headline Match scores describe wording and meaning, not the chance of covering the same event or getting more votes.",
        tables, {"queries": len(queries), "matches": matches, "minimum_age_gap_hours": 24}, matches > 0)


def _feed_metrics(posts, vectors, indices, labels):
    count = len(indices)
    average = None
    if count > 1:
        similarities = vectors[indices] @ vectors[indices].T
        average = round(float(similarities[np.triu_indices(count, 1)].mean()), 3)
    return {"stories": count, "distinct_domains": int(posts.domain.iloc[indices].nunique()),
            "distinct_topics": int(len(set(labels[indices]))) if labels is not None else None,
            "average_pairwise_similarity": average}


def build_balanced_feed(posts, vectors, labels, names):
    recent = _recent(posts, 2, RECENT_LIMIT)
    ranked = sorted(recent, key=lambda index: (-float(posts.upvoteCount.iloc[index]), -int(index)))
    # Remove repeated headlines before scoring either feed.
    candidates, seen = [], set()
    for index in ranked:
        title = str(posts.title.iloc[index]).strip().casefold()
        if title not in seen:
            candidates.append(int(index))
            seen.add(title)
        if len(candidates) == FEED_LIMIT:
            break
    candidates = np.asarray(candidates, dtype=int)
    baseline = candidates[:10]
    chosen = []
    if len(candidates):
        votes = np.log1p(np.maximum(posts.upvoteCount.iloc[candidates].to_numpy(dtype=float), 0))
        relevance = (votes - votes.min()) / max(float(np.ptp(votes)), 1)
        similarity = vectors[candidates] @ vectors[candidates].T
        for _ in range(min(10, len(candidates))):
            redundancy = np.maximum(similarity[:, chosen].max(axis=1), 0) if chosen else np.zeros(len(candidates))
            score = .65 * relevance - .35 * redundancy
            score[chosen] = -np.inf
            chosen.append(int(np.argmax(score)))
    diverse = candidates[chosen]
    tables = []
    for title, indices in [("Highest Saved Votes", baseline), ("Votes and Headline Variety", diverse)]:
        rows = []
        for index in indices:
            row = _headline(posts, index)
            if labels is not None:
                row["Topic Keywords"] = names[int(labels[index])]
            rows.append(row)
        tables.append({"title": title, "rows": rows})
    base_stats = _feed_metrics(posts, vectors, baseline, labels)
    diverse_stats = _feed_metrics(posts, vectors, diverse, labels)
    comparison = (f"The variety feed covers {diverse_stats['distinct_topics']} topics and {diverse_stats['distinct_domains']} websites, versus {base_stats['distinct_topics']} topics and {base_stats['distinct_domains']} websites for highest votes."
                  if labels is not None else
                  f"The variety feed covers {diverse_stats['distinct_domains']} websites, versus {base_stats['distinct_domains']} for highest votes. Older history is too sparse to label topics.")
    return _section("build_balanced_feed", "Build a Balanced Feed",
        comparison + " Compare the tables. Both use the 48 hours ending with the latest saved post; neither uses reader preferences.",
        tables, {"recent_candidates": len(recent), "scored_candidates": len(candidates),
                 "candidate_limit": FEED_LIMIT, "vote_weight": .65, "variety_weight": .35,
                 "baseline": base_stats,
                 "balanced": diverse_stats,
                 "topic_coverage": "Topics learned from older posts" if labels is not None else "Too little older history to label topics"}, len(candidates) >= 2)


def run_story_experiments(posts, vectors, seed=123456):
    """Run four demonstrations using aligned, normalized headline vectors."""
    vectors = np.asarray(vectors, dtype=np.float32)
    if vectors.ndim != 2 or len(vectors) != len(posts) or not np.isfinite(vectors).all():
        raise ValueError("Headline vectors must be finite and align with the saved posts.")
    if not posts.index.equals(pd.RangeIndex(len(posts))) or not posts.created_at.is_monotonic_increasing:
        raise ValueError("Saved posts must use a sequential index and be sorted by creation time.")
    if len(posts) == 0:
        return [_section(identifier, title, "No saved posts are available.", enough=False)
                for identifier, title in [("group_same_story", "Group the Same Story"),
                    ("spot_growing_topics", "Spot Growing Topics"),
                    ("find_similar_stories", "Find Similar Stories"),
                    ("build_balanced_feed", "Build a Balanced Feed")]]
    if posts.created_at.isna().any():
        raise ValueError("Saved posts need valid creation times.")
    _, labels, names, training_count = _topics(posts, vectors, seed)
    return [group_same_story(posts, vectors),
            spot_growing_topics(posts, vectors, labels, names, training_count),
            find_similar_stories(posts, vectors),
            build_balanced_feed(posts, vectors, labels, names)]
