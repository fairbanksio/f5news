"""Compare saved engagement and test a discussion classifier without score leakage."""
import numpy as np
import pandas as pd
from zoneinfo import ZoneInfo
from sklearn.dummy import DummyClassifier
from sklearn.metrics import accuracy_score, balanced_accuracy_score, precision_score, recall_score

from analysis_models import build_candidate


MIN_GROUP = 30


def _section(identifier, title, summary, tables=None, metrics=None, status="complete"):
    return {"id": identifier, "title": title, "summary": summary,
            "tables": tables or [], "metrics": metrics or {}, "status": status}


def _largest(posts):
    data = posts.copy()
    if data.empty or "sub" not in data or data["sub"].dropna().empty:
        return data.iloc[:0], "No subreddit has enough saved posts."
    subreddit = data["sub"].value_counts().index[0]
    return data.loc[data["sub"].eq(subreddit)].copy(), (
        f"Only r/{subreddit}, the largest saved subreddit, is compared. ")


def _age_window(posts):
    age = pd.to_numeric(posts.get("observation_age_hours", pd.Series(index=posts.index, dtype=float)), errors="coerce")
    comparable = age.between(12, 48)
    if comparable.sum() >= 300:
        return posts.loc[comparable].copy(), "Counts were saved 12–48 hours after posting. "
    return posts.copy(), "Snapshot ages are mixed or unknown; older posts have more time. "


def _dated_unique(posts):
    data = posts.copy()
    data["created_at"] = pd.to_datetime(data.get("created_at", pd.Series(index=data.index, dtype=object)), utc=True, errors="coerce")
    comments = pd.to_numeric(data.get("commentCount", pd.Series(index=data.index, dtype=float)), errors="coerce")
    data = data.loc[comments.notna() & np.isfinite(comments) & comments.ge(0) & data["created_at"].notna()].copy()
    data["commentCount"] = comments.loc[data.index]
    data["title"] = data.get("title", pd.Series(index=data.index, dtype=object)).fillna("").astype(str)
    data["_headline"] = data["title"].str.lower().str.replace(r"\s+", " ", regex=True).str.strip()
    data = data.loc[data["_headline"].ne("")].sort_values("created_at", kind="stable")
    return data.drop_duplicates("_headline", keep="first").reset_index(drop=True)


def _chronological_parts(data):
    """Choose boundaries between timestamps, never within one timestamp."""
    ends = data.groupby("created_at", sort=True).size().cumsum().to_numpy()
    choices = ends[:-1]
    if len(choices) < 2:
        return None
    first = int(choices[np.argmin(np.abs(choices - len(data) * .6))])
    later = choices[choices > first]
    if not len(later):
        return None
    second = int(later[np.argmin(np.abs(later - len(data) * .8))])
    return data.iloc[:first], data.iloc[first:second], data.iloc[second:]


def _scores(labels, predicted):
    return {"accuracy": float(accuracy_score(labels, predicted)),
            "balanced_accuracy": float(balanced_accuracy_score(labels, predicted)),
            "precision": float(precision_score(labels, predicted, zero_division=0)),
            "recall": float(recall_score(labels, predicted, zero_division=0))}


def _discussion(posts, context, seed):
    title = "Predict Discussion"
    explanation = context + "The target is 100+ saved comments, not the final total. "
    data = _dated_unique(posts)
    parts = _chronological_parts(data)
    if len(data) < 200 or parts is None:
        return _section("predict_discussion", title, explanation + "Too few dated, distinct headlines to test this fairly.", metrics={"eligible_posts": len(data)}, status="insufficient_data")
    labels = [part["commentCount"].ge(100).astype(int) for part in parts]
    if any(len(part) < minimum or y.value_counts().reindex([0, 1], fill_value=0).min() < 5
           for part, y, minimum in zip(parts, labels, [100, 30, 30])):
        return _section("predict_discussion", title, explanation + "Each time period needs enough examples on both sides of 100 comments.", metrics={"eligible_posts": len(data)}, status="insufficient_data")
    # Explicitly pass only clues available when the post was created.
    columns = [column for column in ["title", "domain", "created_at", "is_self", "is_video"] if column in data]
    train, validation, test = [part[columns] for part in parts]
    options = [
        ("Title", {"kind": "char", "classifier": "sgd", "alpha": .0001}),
        ("Title And Posting Clues", {"kind": "context_char", "classifier": "sgd", "alpha": .0001}),
        ("Title And Posting Clues (Alternative)", {"kind": "context_char", "classifier": "sgd", "alpha": .001}),
    ]
    trials = []
    try:
        for name, settings in options:
            model = build_candidate(settings, seed=seed).fit(train, labels[0])
            score = float(balanced_accuracy_score(labels[1], model.predict(validation)))
            trials.append((score, name, settings))
        _, name, settings = max(trials, key=lambda trial: trial[0])
        older = pd.concat([train, validation])
        older_labels = pd.concat(labels[:2])
        fitted = build_candidate(settings, seed=seed).fit(older, older_labels)
        predicted = fitted.predict(test)
    except ValueError:
        return _section("predict_discussion", title, explanation + "The older headlines do not contain enough usable text to fit a model.", metrics={"eligible_posts": len(data)}, status="insufficient_data")
    baseline = DummyClassifier(strategy="most_frequent").fit(np.zeros((len(older), 1)), older_labels)
    baseline_predicted = baseline.predict(np.zeros((len(test), 1)))
    model_scores = _scores(labels[2], predicted)
    baseline_scores = _scores(labels[2], baseline_predicted)
    rows = []
    for label, scores in [("Computer Guess", model_scores), ("Always Guess the Common Answer", baseline_scores)]:
        rows.append({"Model": label, "Test Posts": len(test),
                     "Correct Guesses (%)": 100 * scores["accuracy"],
                     "100+ Guesses That Were Right (%)": 100 * scores["precision"],
                     "Actual 100+ Posts Found (%)": 100 * scores["recall"]})
    counts = [{"Period": period, "Posts": len(part), "100+ Saved Comments": int(y.sum()),
               "Under 100 Saved Comments": int(len(y) - y.sum())}
              for period, part, y in zip(["Older Training", "Middle Validation", "Newest Test"], parts, labels)]
    difference = model_scores["balanced_accuracy"] - baseline_scores["balanced_accuracy"]
    outcome = "beat" if difference > .001 else "fell behind" if difference < -.001 else "matched"
    return _section("predict_discussion", title, explanation +
                    f"It learned from older posts and guessed newer ones. Across both answers, it {outcome} the always-same guess.",
                    tables=[{"title": "Newest Posts Only", "rows": rows}],
                    metrics={"eligible_posts": len(data), "selected_candidate": name, "model": model_scores, "baseline": baseline_scores,
                             "test_posts": len(test), "test_100_plus": int(labels[2].sum()),
                             "target_comments": 100, "split_counts": counts,
                             "validation_trials": [{"candidate": candidate, "balanced_accuracy": score} for score, candidate, _ in trials],
                             "split_method": "Chronological 60/20/20; equal timestamps stay together; normalized duplicate titles removed first",
                             "label_caveat": "Missing comments excluded; saved comment totals can depend on snapshot age",
                             "test_correct_guesses": int(np.sum(np.asarray(labels[2]) == predicted))})


def _numeric(data, column):
    values = pd.to_numeric(data.get(column, pd.Series(index=data.index, dtype=float)), errors="coerce")
    return values.where(np.isfinite(values) & values.ge(0))


def _publishers(posts, context):
    data, age_note = _age_window(posts)
    data["_votes"] = _numeric(data, "upvoteCount")
    data["_comments"] = _numeric(data, "commentCount")
    data["_domain"] = data.get("domain", pd.Series(index=data.index, dtype=object)).fillna("").astype(str).str.strip().str.lower()
    rows, coverage = [], {}
    for domain, group in data.loc[data["_domain"].ne("")].groupby("_domain"):
        if len(group) < MIN_GROUP:
            continue
        votes, comments = group["_votes"].dropna(), group["_comments"].dropna()
        coverage[domain] = {"known_votes": len(votes), "known_comments": len(comments)}
        rows.append({"Website": domain, "Posts": len(group),
                     "Typical Saved Votes": float(votes.median()) if len(votes) else None,
                     "Typical Saved Comments": float(comments.median()) if len(comments) else None,
                     "1,000+ Votes (%)": 100 * float(votes.ge(1000).mean()) if len(votes) else None})
    rows = sorted(rows, key=lambda row: (-row["Posts"], row["Website"]))[:10]
    return _section("compare_publishers", "Compare Publishers", context + age_note +
                    "Websites need 30 posts; the ten largest are shown. Topic mix can explain engagement; this does not measure trustworthiness.",
                    tables=[{"title": "Saved Engagement By Website", "rows": rows}],
                    metrics={"compared_posts": len(data), "minimum_posts_per_website": MIN_GROUP,
                             "count_coverage": {row["Website"]: coverage[row["Website"]] for row in rows},
                             "missing_counts": "Excluded separately from vote and comment statistics; typical means median"},
                    status="complete" if rows else "insufficient_data")


def _posting_times(posts, context):
    data, age_note = _age_window(posts)
    times = pd.to_datetime(data.get("created_at", pd.Series(index=data.index, dtype=object)), utc=True, errors="coerce").dt.tz_convert(ZoneInfo("America/Los_Angeles"))
    data["_day"] = times.dt.dayofweek
    data["_block"] = (times.dt.hour // 4) * 4
    data["_votes"] = _numeric(data, "upvoteCount")
    days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    blocks = {0: "12:00 AM–3:59 AM", 4: "4:00 AM–7:59 AM", 8: "8:00 AM–11:59 AM",
              12: "12:00 PM–3:59 PM", 16: "4:00 PM–7:59 PM", 20: "8:00 PM–11:59 PM"}
    tables = []
    for column, heading, labels in [("_day", "Day Of Week", dict(enumerate(days))), ("_block", "Four-Hour Block", blocks)]:
        rows = []
        for key, group in data.groupby(column, sort=True):
            votes = group["_votes"].dropna()
            if len(votes) >= MIN_GROUP:
                rows.append({heading: labels[int(key)], "Posts With Vote Counts": len(votes), "Median Saved Votes": float(votes.median())})
        tables.append({"title": heading + " (Pacific Time)", "rows": rows})
    return _section("compare_posting_times", "Compare Posting Times", context + age_note +
                    "Groups need 30 known vote counts. Topic mix can explain differences; these patterns do not establish the best posting time.",
                    tables=tables, metrics={"compared_posts": len(data), "timezone": "America/Los_Angeles", "minimum_known_votes_per_group": MIN_GROUP,
                                            "topic_matching": "Topics are not matched", "clock": "Pacific time follows daylight saving time"},
                    status="complete" if any(table["rows"] for table in tables) else "insufficient_data")


def run_engagement_experiments(posts, vectors=None, seed=123456):
    """Return three report sections. Embeddings are optional and never downloaded."""
    data, context = _largest(posts)
    return [_discussion(data, context, seed), _publishers(data, context), _posting_times(data, context)]
