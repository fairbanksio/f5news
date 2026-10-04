"""Build predictors from headline text and clues available when a post is created."""
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression, SGDClassifier
from sklearn.naive_bayes import ComplementNB
from sklearn.pipeline import FeatureUnion, FunctionTransformer, Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


def model_features(posts):
    """Exclude scores and fetch times from the model's inputs."""
    if not isinstance(posts, pd.DataFrame):
        posts = pd.DataFrame({"title": list(posts)})
    features = pd.DataFrame(index=posts.index)
    features["title"] = posts["title"].fillna("").astype(str)
    features["domain"] = posts.get("domain", pd.Series(index=posts.index, dtype=object)).map(
        lambda value: value.strip().lower() if isinstance(value, str) and value.strip() else "unknown"
    )
    if "created_at" in posts:
        created = pd.to_datetime(posts["created_at"], utc=True, errors="coerce")
    else:
        seconds = pd.to_numeric(posts.get("created_utc", pd.Series(index=posts.index, dtype=float)), errors="coerce")
        created = pd.to_datetime(seconds, unit="s", utc=True, errors="coerce")
    for name, values in (("hour", created.dt.hour), ("day", created.dt.dayofweek)):
        features[name] = values.map(lambda value: str(int(value)) if pd.notna(value) else "unknown")
    for name in ("is_self", "is_video"):
        values = posts.get(name, pd.Series(index=posts.index, dtype=object))
        features[name] = values.map(lambda value: str(value) if isinstance(value, (bool, np.bool_)) else "unknown")
    features["length"] = features["title"].str.len()
    features["words"] = features["title"].str.split().str.len()
    features["question"] = features["title"].str.count(r"\?")
    features["caps"] = features["title"].str.count("[A-Z]") / features["length"].clip(lower=1)
    return features


def build_candidate(options, seed=123456):
    kind = options["kind"]
    chars = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), max_features=40000,
                            min_df=2, sublinear_tf=True)
    if kind == "word_char_nb":
        words = TfidfVectorizer(ngram_range=(1, 2), max_features=40000, min_df=2, sublinear_tf=True)
        text = FeatureUnion([("char", chars), ("word", words)])
        features = ColumnTransformer([("text", text, "title")])
        classifier = ComplementNB(alpha=options.get("alpha", 1.0))
    else:
        parts = [("text", chars, "title")]
        weights = None
        if kind == "domain_char":
            parts.append(("meta", OneHotEncoder(handle_unknown="infrequent_if_exist", min_frequency=10), ["domain"]))
        elif kind == "context_char":
            parts.extend([
                ("meta", OneHotEncoder(handle_unknown="infrequent_if_exist", min_frequency=10),
                 ["domain", "hour", "day", "is_self", "is_video"]),
                ("stats", StandardScaler(), ["length", "words", "question", "caps"]),
            ])
            weight = options.get("metadata_weight", 0.25)
            weights = {"meta": weight, "stats": weight}
        elif kind != "char":
            raise ValueError("Unknown model candidate.")
        features = ColumnTransformer(parts, transformer_weights=weights)
        if options.get("classifier") == "sgd":
            classifier = SGDClassifier(loss="log_loss", alpha=options.get("alpha", 0.0001),
                                       max_iter=1000, tol=0.001, random_state=seed)
        else:
            classifier = LogisticRegression(C=options.get("C", 1.0), max_iter=1000, random_state=seed)
    return Pipeline([
        ("inputs", FunctionTransformer(model_features, validate=False)),
        ("features", features),
        ("classifier", classifier),
    ])
