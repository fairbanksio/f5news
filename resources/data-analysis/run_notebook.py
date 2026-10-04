"""Run the analysis notebook and export a browser report."""
import argparse
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
        config = Config()
        config.HTMLExporter.exclude_input = True
        config.HTMLExporter.theme = "dark"
        exporter = HTMLExporter(config=config, template_name="lab")
        report, _ = exporter.from_notebook_node(notebook)
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
