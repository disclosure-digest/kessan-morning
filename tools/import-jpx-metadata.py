import json
import sys
from pathlib import Path

import xlrd


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_XLS = Path("work/data_j.xls")


def normalize_code(value):
    if isinstance(value, float):
        return str(int(value)).zfill(4)
    return str(value).strip().split(".")[0].zfill(4)


def normalize_topix_size(value):
    text = str(value).strip()
    mapping = {
        "TOPIX Core30": "Core30",
        "TOPIX Large70": "Large70",
        "TOPIX Mid400": "Mid400",
        "TOPIX Small 1": "Small1",
        "TOPIX Small 2": "Small2",
    }
    return mapping.get(text, text or None)


def main():
    xls_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_XLS
    output_path = ROOT / "data" / "company-metadata.json"

    book = xlrd.open_workbook(str(xls_path))
    sheet = book.sheet_by_index(0)
    headers = [str(sheet.cell_value(0, col)).strip() for col in range(sheet.ncols)]
    indexes = {name: headers.index(name) for name in headers}

    companies = {}
    for row in range(1, sheet.nrows):
        code = normalize_code(sheet.cell_value(row, indexes["コード"]))
        companies[code] = {
            "name": str(sheet.cell_value(row, indexes["銘柄名"])).strip(),
            "market": str(sheet.cell_value(row, indexes["市場・商品区分"])).strip(),
            "industry33": str(sheet.cell_value(row, indexes["33業種区分"])).strip(),
            "industry17": str(sheet.cell_value(row, indexes["17業種区分"])).strip(),
            "topixSize": normalize_topix_size(sheet.cell_value(row, indexes["規模区分"])),
            "marketCap": None
        }

    payload = {
        "description": "JPX listed company metadata. marketCap is yen when separately supplied; topixSize is used as market-impact proxy when marketCap is unavailable.",
        "source": "JPX 東証上場銘柄一覧 data_j.xls",
        "companies": companies,
    }
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(companies)} companies to {output_path}")


if __name__ == "__main__":
    main()
