import csv
from pathlib import Path
from tempfile import NamedTemporaryFile


class CsvRepository:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)

    def ensure_file(self, filename: str, fieldnames: list[str]) -> Path:
        path = self.data_dir / filename
        if not path.exists():
            self._write_rows(path, fieldnames, [])
        return path

    def read_rows(self, filename: str, fieldnames: list[str]) -> list[dict[str, str]]:
        path = self.ensure_file(filename, fieldnames)
        with path.open("r", newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            return [dict(row) for row in reader]

    def write_rows(
        self, filename: str, fieldnames: list[str], rows: list[dict[str, object]]
    ) -> None:
        path = self.ensure_file(filename, fieldnames)
        self._write_rows(path, fieldnames, rows)

    def append_row(self, filename: str, fieldnames: list[str], row: dict[str, object]) -> None:
        rows = self.read_rows(filename, fieldnames)
        rows.append(row)
        self.write_rows(filename, fieldnames, rows)

    def _write_rows(
        self, path: Path, fieldnames: list[str], rows: list[dict[str, object]]
    ) -> None:
        with NamedTemporaryFile(
            "w",
            newline="",
            encoding="utf-8",
            delete=False,
            dir=path.parent,
        ) as tmp:
            writer = csv.DictWriter(tmp, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            for row in rows:
                writer.writerow(
                    {
                        field: self._serialize_value(row.get(field, ""))
                        for field in fieldnames
                    }
                )
            temp_path = Path(tmp.name)
        temp_path.replace(path)

    @staticmethod
    def _serialize_value(value: object) -> str:
        if value is None:
            return ""
        if isinstance(value, bool):
            return "true" if value else "false"
        return str(value)

