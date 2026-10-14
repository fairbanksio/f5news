"""Run the analysis notebook and export a browser report."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

import nbformat
from nbclient import NotebookClient
from nbclient.exceptions import CellTimeoutError
from jupyter_client import AsyncKernelManager
from jupyter_client.kernelspec import KernelSpec
from nbconvert import HTMLExporter
from traitlets.config import Config


class RunnerKernelManager(AsyncKernelManager):
    @property
    def kernel_spec(self):
        return KernelSpec(
            argv=[sys.executable, "-m", "ipykernel_launcher", "-f", "{connection_file}"],
            display_name="F5 Analysis", language="python",
        )


def render_report(notebook, summary=None):
    """Show results without the notebook's setup and explanatory prose."""
    report_notebook = nbformat.v4.new_notebook(cells=[nbformat.v4.new_markdown_cell(
        "# Can We Predict Upvotes?\n\nThe computer learns from older headlines, websites, and posting times, then tries to guess "
        "the upvote range of newer posts. These are saved upvote counts, not final totals."
    )])
    if summary:
        cleaning = summary["cleaning"]
        description = (
            f"Used **{cleaning['usable']:,} posts** and checked guesses on **{summary['test_posts']:,} newer posts**. "
            f"Posts span {summary['first_post'][:10]} to {summary['last_post'][:10]}. "
            f"Reading data took {summary['fetch_seconds']:.1f}s; learning and comparing took "
            f"{summary['training_seconds']:.1f}s."
        )
        report_notebook.cells.append(nbformat.v4.new_markdown_cell(description))
        accuracy = summary["model_metrics"]["accuracy"]
        baseline_accuracy = summary["baseline_metrics"]["accuracy"]
        verdict = (
            "The computer gets more ranges right than the simple guess."
            if accuracy > baseline_accuracy else
            "The computer still gets fewer ranges right than the simple guess."
            if accuracy < baseline_accuracy else
            "The computer and simple guess get the same share right."
        )
        if accuracy < 0.5:
            verdict += " It misses more than half, so don't rely on these predictions yet."
        report_notebook.cells.append(nbformat.v4.new_markdown_cell(
            f"## Is It Useful Yet?\n\n{verdict}\n\n"
            "| Approach | Guesses in the Correct Range |\n| --- | --- |\n"
            f"| Selected Range Model | {accuracy:.1%} |\n"
            + (f"| Headlines Only | {summary['headline_reference_metrics']['accuracy']:.1%} |\n"
               if "headline_reference_metrics" in summary else "")
            + f"| Always Guess the Most Common Range | {baseline_accuracy:.1%} |"
            + (f"\n\n**{summary['within_one_range']:.1%}** were correct or one range away."
               if "within_one_range" in summary else "")
        ))
        semantic_status = (
            "Headline meaning was tested alongside word patterns and posting clues. "
            "Older posts chose which approach to use."
            if summary.get("semantic_enabled") else
            "Headline meaning was not tested in this run. Use `--semantic` to include it."
        )
        report_notebook.cells.append(nbformat.v4.new_markdown_cell(semantic_status))
        if "binary" in summary:
            binary = summary["binary"]
            model = binary["model_metrics"]
            baseline = binary["baseline_metrics"]
            binary_verdict = (
                "The computer gets more Yes/No answers right than the simple guess."
                if model["accuracy"] > baseline["accuracy"] else
                "The computer gets fewer Yes/No answers right than the simple guess."
                if model["accuracy"] < baseline["accuracy"] else
                "The computer and simple guess get the same share of Yes/No answers right."
            )
            rows = [
                ("Correct Yes or No Guesses", "accuracy"),
                ("Yes Guesses That Were Right", "precision"),
                ("Real Yes Posts Found", "recall"),
            ]
            comparison = "\n".join(
                f"| {label} | {model[key]:.1%} | {baseline[key]:.1%} |"
                for label, key in rows
            )
            report_notebook.cells.append(nbformat.v4.new_markdown_cell(
                "## Can It Spot 1,000+ Upvotes?\n\n"
                "Yes means a saved count of at least 1,000 upvotes. "
                "The simple guess always chooses the most common answer. "
                f"**{binary['positive_test_posts']:,} of {binary['test_posts']:,} test posts** were Yes.\n\n"
                f"{binary_verdict}\n\n"
                "| Measure | Selected Yes/No Model | Simple Guess |\n| --- | --- | --- |\n"
                f"{comparison}"
            ))
    sections = {
        "evaluate": ("Where the Guesses Go Wrong", (
            (2, "Correct Range means the guessed 500-upvote range was right. Each step away means another "
                "500-upvote range missed. Taller bars show more guesses at that distance; "
                "this is range distance, not the exact upvote error."),
        )),
        "coverage": ("What It Learned From", (
            (1, "These are the 12 most common ranges. Each covers 500 upvotes: 0–499, 500–999, 1,000–1,499, and so on. "
                "Taller bars mean more posts in that upvote range. "
                "Small bars mean fewer examples, so those ranges are harder to learn."),
        )),
        "predict": ("Check Real Examples", (
            (0, "These are randomly chosen real posts the computer was not taught from. Compare its guess with the actual range. "
                "The percentage shows how strongly the computer favors its guess, not a proven chance of being right. "
                "Yes means it got the range right; No means it missed."),
        )),
    }
    for tag, (heading, outputs) in sections.items():
        cell = next(c for c in notebook.cells if tag in c.metadata.get("tags", []))
        report_notebook.cells.append(nbformat.v4.new_markdown_cell(f"## {heading}"))
        for output_index, caption in outputs:
            report_notebook.cells.append(nbformat.v4.new_markdown_cell(caption))
            report_notebook.cells.append(nbformat.v4.new_code_cell(
                source="", outputs=[cell.outputs[output_index]],
            ))
    config = Config()
    config.HTMLExporter.exclude_input = True
    config.HTMLExporter.theme = "dark"
    exporter = HTMLExporter(config=config, template_name="lab")
    report, _ = exporter.from_notebook_node(report_notebook)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-open", action="store_true", help="Save the report without opening a browser")
    parser.add_argument("--semantic", action="store_true", help="Also compare models that use headline meaning")
    args = parser.parse_args()
    if args.semantic:
        os.environ["F5_SEMANTIC"] = "1"
    analysis_dir = Path(__file__).resolve().parent
    output_dir = analysis_dir / "models"
    output_dir.mkdir(exist_ok=True)
    os.environ.setdefault("MPLCONFIGDIR", str(output_dir / "matplotlib"))
    notebook = nbformat.read(analysis_dir / "f5-spark-analysis.ipynb", as_version=4)

    current_section = "Startup"

    def progress(cell, cell_index):
        nonlocal current_section
        if cell.cell_type == "markdown":
            heading = cell.source.splitlines()[0].lstrip("# ")
            current_section = heading
            print(heading, flush=True)

    print("Running the notebook with a read-only database sample...", flush=True)
    client = NotebookClient(
        notebook, timeout=900 if args.semantic else 300, resources={"metadata": {"path": str(analysis_dir.parents[1])}},
        on_cell_start=progress, kernel_manager_class=RunnerKernelManager,
    )
    # Launch this environment directly; no registered kernel or editor discovery is needed.
    try:
        client.execute()
        summary = json.loads((output_dir / "latest-results.json").read_text())
        report = render_report(notebook, summary)
    except CellTimeoutError:
        print(f"Analysis timed out in {current_section}. Previous reports were not updated.", file=sys.stderr)
        return 1
    except Exception:
        print(
            f"Analysis failed in {current_section}. Check root .env Vault access, database reachability, "
            "and notebook configuration. "
            "Previous reports were not updated. Error details are hidden to protect credentials.",
            file=sys.stderr,
        )
        return 1
    nbformat.write(notebook, output_dir / "latest-run.ipynb")
    report_path = output_dir / "latest-report.html"
    report_path.write_text(report, encoding="utf-8")
    print(f"Report: {report_path}", flush=True)
    if not args.no_open and sys.platform == "darwin":
        result = subprocess.run(["open", str(report_path)], check=False)
        if result.returncode:
            print("Open the report path above in your browser.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
