/**
 * Base de données produits scannables (boissons, snacks…)
 *
 * ─── Comment ajouter un produit ──────────────────────────────────────────────
 *  1. Scannez le code-barres de votre produit → notez le numéro affiché
 *  2. Ajoutez une ligne dans PRODUCTS :
 *       "CODE_BARRES": { barcode: "CODE_BARRES", nameFr: "Nom FR", nameEn: "Name EN", priceCad: X.XX },
 *  3. Sauvegardez → git push → déploiement automatique
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type Product = {
  barcode: string;
  nameFr: string;
  nameEn: string;
  /** Prix en dollars CAD, avant taxes */
  priceCad: number;
};

export type CartItem = Product & { quantity: number };

// ─────────────────────────────────────────────────────────────────────────────
// CATALOGUE  —  Remplacez les codes-barres par vos vrais EAN/UPC
// ─────────────────────────────────────────────────────────────────────────────
export const PRODUCTS: Record<string, Product> = {
  // ── Eaux ──────────────────────────────────────────────────────────────────
  "5901234123457": {
    barcode: "5901234123457",
    nameFr: "Eau minérale 500 ml",
    nameEn: "Mineral Water 500 ml",
    priceCad: 2.50,
  },

  // ── Boissons coréennes ────────────────────────────────────────────────────
  "4902102141673": {
    barcode: "4902102141673",
    nameFr: "Pocari Sweat 500 ml",
    nameEn: "Pocari Sweat 500 ml",
    priceCad: 3.25,
  },
  "8801007016034": {
    barcode: "8801007016034",
    nameFr: "Milkis Original 250 ml",
    nameEn: "Milkis Original 250 ml",
    priceCad: 2.75,
  },
  "8801007016041": {
    barcode: "8801007016041",
    nameFr: "Milkis Fraise 250 ml",
    nameEn: "Milkis Strawberry 250 ml",
    priceCad: 2.75,
  },
  "8801007016058": {
    barcode: "8801007016058",
    nameFr: "Milkis Pomme 250 ml",
    nameEn: "Milkis Apple 250 ml",
    priceCad: 2.75,
  },

  // ── Thés & Cafés ──────────────────────────────────────────────────────────
  "4901777261075": {
    barcode: "4901777261075",
    nameFr: "Thé vert Ito En 500 ml",
    nameEn: "Ito En Green Tea 500 ml",
    priceCad: 3.75,
  },
  "8850718800122": {
    barcode: "8850718800122",
    nameFr: "Café glacé Thai 325 ml",
    nameEn: "Thai Iced Coffee 325 ml",
    priceCad: 3.00,
  },

  // ── Jus ───────────────────────────────────────────────────────────────────
  "8801187005453": {
    barcode: "8801187005453",
    nameFr: "Jus de raisin 340 ml",
    nameEn: "Grape Juice 340 ml",
    priceCad: 3.50,
  },

  // ── Ajoutez vos produits ici ──────────────────────────────────────────────
  // "EAN_DE_VOTRE_PRODUIT": {
  //   barcode: "EAN_DE_VOTRE_PRODUIT",
  //   nameFr: "Nom en français",
  //   nameEn: "English name",
  //   priceCad: 0.00,
  // },
};
