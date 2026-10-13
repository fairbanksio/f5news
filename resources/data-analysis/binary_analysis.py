"""Compare models for whether a post's saved score reaches 1,000 upvotes."""
import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.metrics import (accuracy_score, balanced_accuracy_score, f1_score,
                             precision_score, recall_score)

from analysis_models import build_candidate


THRESHOLDS = (0.3, 0.4, 0.5, 0.6)
BASE_CANDIDATES = (
    ("Headline Only", {"kind": "char", "C": 3.0}),
    ("Words and Letters", {"kind": "word_char_nb", "alpha": 1.0}),
    ("Headline and Website", {"kind": "domain_char", "C": 1.0}),
    ("Headline and Posting Clues", {"kind": "context_char", "C": 1.0, "metadata_weight": 0.25}),
    ("Stronger Posting Clues", {"kind": "context_char", "C": 1.0, "metadata_weight": 1.0}),
)


def binary_target(posts, partition="Posts"):
    """Use an inclusive boundary and require both outcomes for useful metrics."""
    if len(posts) == 0:
        raise ValueError(f"{partition} is empty. Need posts below and at or above 1,000 upvotes.")
    if "upvoteCount" not in posts:
        raise ValueError(f"{partition} is missing saved upvote counts.")
    votes = pd.to_numeric(posts["upvoteCount"], errors="coerce")
    if not np.isfinite(votes).all() or (votes < 0).any() or posts["upvoteCount"].map(
        lambda value: isinstance(value, (bool, np.bool_))
    ).any():
        raise ValueError(f"{partition} has invalid saved upvote counts.")
    target = (votes >= 1000).astype(int)
    if target.nunique() != 2:
        raise ValueError(f"{partition} needs both No and Yes outcomes; one-class accuracy can mislead.")
    return target


def positive_probabilities(model, posts):
    """Find the Yes column from the estimator's class order."""
    classes = np.asarray(model.classes_)
    positions = np.flatnonzero(classes == 1)
    if len(positions) != 1:
        raise ValueError("The fitted model must include the Yes class (1).")
    probabilities = np.asarray(model.predict_proba(posts))
    if probabilities.shape != (len(posts), len(classes)):
        raise ValueError("The fitted model returned an invalid probability shape.")
    positive = probabilities[:, positions[0]]
    if not np.isfinite(positive).all() or ((positive < 0) | (positive > 1)).any():
        raise ValueError("The fitted model returned invalid Yes probabilities.")
    return positive


def binary_metrics(actual, predicted):
    return {
        "accuracy": float(accuracy_score(actual, predicted)),
        "balanced_accuracy": float(balanced_accuracy_score(actual, predicted)),
        "precision": float(precision_score(actual, predicted, zero_division=0)),
        "recall": float(recall_score(actual, predicted, zero_division=0)),
        "f1": float(f1_score(actual, predicted, zero_division=0)),
    }


def run_binary_experiment(train, validation, development, test, seed=123456, extra_candidates=None):
    """Freeze validation-selected settings, refit, then evaluate the test once.

    Callers supply chronological partitions. Extra candidates must be unfitted
    sklearn estimators that accept post DataFrames and expose predict_proba.
    """
    targets = {
        name: binary_target(posts, name)
        for name, posts in (("Training", train), ("Validation", validation),
                            ("Development", development))
    }
    candidates = [(name, build_candidate(options, seed)) for name, options in BASE_CANDIDATES]
    candidates.extend(extra_candidates or [])
    rows, best_key, selected = [], None, None
    for name, estimator in candidates:
        candidate = clone(estimator).fit(train, targets["Training"])
        positive = positive_probabilities(candidate, validation)
        for threshold in THRESHOLDS:
            metrics = binary_metrics(targets["Validation"], positive >= threshold)
            rows.append({"Candidate": name, "threshold": threshold, **metrics})
            key = (metrics["balanced_accuracy"], metrics["accuracy"], -abs(threshold - 0.5))
            if best_key is None or key > best_key:
                best_key = key
                selected = (name, estimator, threshold)

    selected_name, estimator, threshold = selected
    # Test labels are read only after the candidate and threshold are frozen.
    targets["Test"] = binary_target(test, "Test")
    model = clone(estimator).fit(development, targets["Development"])
    positive = positive_probabilities(model, test)
    predicted = (positive >= threshold).astype(int)
    majority = int(targets["Development"].mean() > 0.5)
    summary = {
        "target": "saved_upvotes_at_least_1000",
        "selected_name": selected_name,
        "threshold": threshold,
        "selection_metric": "validation_balanced_accuracy",
        "validation_results": rows,
        "model_metrics": binary_metrics(targets["Test"], predicted),
        "baseline_metrics": binary_metrics(targets["Test"], np.full(len(test), majority)),
        "positive_test_posts": int(targets["Test"].sum()),
        "test_posts": len(test),
    }
    actual = targets["Test"].to_numpy()
    predictions = pd.DataFrame({
        "Title": test["title"].to_numpy(),
        "Guessed 1,000+?": np.where(predicted, "Yes", "No"),
        "Actual 1,000+?": np.where(actual, "Yes", "No"),
        "Yes Strength": positive,
        "Right?": np.where(predicted == actual, "Yes", "No"),
    }, index=test.index)
    return model, summary, predictions
