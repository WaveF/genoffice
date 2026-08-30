#!/usr/bin/env python3
"""Rename the primary name-table records in NexOffice's bundled derivative fonts.

The bundled WOFF2 files are already locally modified subsets with validated
metrics. Rebuilding them during a product rename would require downloading
upstream sources and could accidentally change glyph coverage or advances.
This script deliberately changes only the primary display/PostScript identity
records, preserving outlines, metrics, license records, and all other tables.
"""

from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.ttLib.woff2 import WOFF2FlavorData


ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "apps/docs/src/renderer/fonts"
FONT_NAMES = {
    "NexOfficeSansKR-Regular-subset.woff2": ("NexOffice Sans KR", "NexOfficeSansKR-Regular"),
    "NexOfficeSerifKR-Regular-subset.woff2": ("NexOffice Serif KR", "NexOfficeSerifKR-Regular"),
    "NexOfficeGothicKR-Regular-subset.woff2": ("NexOffice Gothic KR", "NexOfficeGothicKR-Regular"),
    "NexOfficeCheLatinKR.woff2": ("NexOffice Che Latin KR", "NexOfficeCheLatinKR"),
    "NexOfficeTamil-Regular.woff2": ("NexOffice Tamil", "NexOfficeTamil-Regular"),
    "NexOfficePUABlank.woff2": ("NexOffice PUA Blank", "NexOfficePUABlank"),
}


def rename_font(path: Path, family: str, postscript_name: str) -> None:
    font = TTFont(path, recalcTimestamp=False)
    values = {
        1: family,
        3: f"{family} Regular",
        4: f"{family} Regular",
        6: postscript_name,
        16: family,
        18: f"{family} Regular",
        20: postscript_name,
        21: family,
        25: postscript_name,
    }
    for record in font["name"].names:
        value = values.get(record.nameID)
        if value is not None:
            font["name"].setName(
                value, record.nameID, record.platformID, record.platEncID, record.langID
            )

    font.flavor = "woff2"
    # Keep the direct glyf/loca layout expected by the metric-test reader.
    font.flavorData = WOFF2FlavorData(transformedTables=())
    font.save(path)
    print(path.name)


for filename, (family, postscript_name) in FONT_NAMES.items():
    rename_font(FONTS / filename, family, postscript_name)
