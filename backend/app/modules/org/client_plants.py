"""The seven Sheet Shapers plants (docs/client/client-answers-2026-10.md).

Business information the client gave us, already public in the repository. No map positions:
an admin places each plant and draws its geofence on site (spec §7 rule 17).
"""

from dataclasses import dataclass

MIDC_WALUJ = "MIDC, Waluj, Aurangabad 431136"


@dataclass(frozen=True)
class ClientPlant:
    code: str
    name: str
    address: str


CLIENT_PLANTS = (
    ClientPlant("K134", "Sheet Shapers India Pvt Ltd (K-134)", f"K-134, {MIDC_WALUJ}"),
    ClientPlant("X280", "Sheet Shapers India Pvt Ltd (X-280)", f"72, X-280, {MIDC_WALUJ}"),
    ClientPlant("PC1", "Precise Cuts India Pvt Ltd, Unit 1", f"E-70/22, {MIDC_WALUJ}"),
    ClientPlant("PC2", "Precise Cuts India Pvt Ltd, Unit 2", f"E-70/20, {MIDC_WALUJ}"),
    ClientPlant("SPI", "Siddharth Pressings India Pvt Ltd", f"C-97, {MIDC_WALUJ}"),
    ClientPlant("TP1", "Tirupati Pressco, Unit 1", f"9, S.L.U.Y., {MIDC_WALUJ}"),
    ClientPlant("TP2", "Tirupati Pressco, Unit 2", f"9/1, S.L.U.Y., {MIDC_WALUJ}"),
)
