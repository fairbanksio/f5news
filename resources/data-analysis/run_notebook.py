"""Run the analysis notebook and export a browser report."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

import nbformat
from nbclient import NotebookClient
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
        "# F5 News Results\n\nPredicts observed upvote ranges from titles. Scores are not final popularity."
    )])
    if summary:
        cleaning = summary["cleaning"]
        description = (
            f"{cleaning['usable']:,} usable posts · {summary['test_posts']:,} test posts · "
            f"{summary['first_post'][:10]} to {summary['last_post'][:10]}\n\n"
            f"Fetched in {summary['fetch_seconds']:.1f}s; compared and trained models in "
            f"{summary['training_seconds']:.1f}s. Selected by validation weighted F1."
        )
        report_notebook.cells.append(nbformat.v4.new_markdown_cell(description))
        model_metrics = summary["model_metrics"]
        baseline_metrics = summary["baseline_metrics"]
        result_note = (
            f"Weighted F1: {model_metrics['weighted_f1']:.3f} for the model vs. "
            f"{baseline_metrics['weighted_f1']:.3f} for the baseline. "
            f"Accuracy: {model_metrics['accuracy']:.1%} vs. {baseline_metrics['accuracy']:.1%}."
        )
        report_notebook.cells.append(nbformat.v4.new_markdown_cell(result_note))
    sections = {
        "evaluate": ("Model vs. Baseline", (
            (0, "Accuracy is the share of correct predictions. F1 balances precision and recall; "
                "macro F1 weights all ranges equally, while weighted F1 reflects their frequency. "
                "Higher is better. The baseline always predicts the most common training range."),
            (2, "Rows show observed ranges; columns show predicted ranges. "
                "Diagonal counts are correct predictions. Off-diagonal counts are errors."),
        )),
        "coverage": ("Upvote Distribution", (
            (1, "Bars count sampled posts in each upvote range. "
                "Rare ranges give the model fewer examples to learn from."),
        )),
        "predict": ("Sample Predictions", (
            (0, "Each title gets a predicted upvote range. "
                "Model Score reflects the model's preference for that range, not a guarantee."),
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
    args = parser.parse_args()
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
        notebook, timeout=300, resources={"metadata": {"path": str(analysis_dir.parents[1])}},
        on_cell_start=progress, kernel_manager_class=RunnerKernelManager,
    )
    # Launch this environment directly; no registered kernel or editor discovery is needed.
    try:
        client.execute()
        summary = json.loads((output_dir / "latest-results.json").read_text())
        report = render_report(notebook, summary)
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
