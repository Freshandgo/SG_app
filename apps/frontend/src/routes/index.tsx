import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect, useCallback } from "react";
import {
  Check,
  CreditCard,
  Smartphone,
  Loader2,
  AlertCircle,
  X,
  Plus,
  Minus,
  ScanLine,
  Keyboard,
  Camera,
} from "lucide-react";
import { loadStripeTerminal } from "@stripe/terminal-js";
import type { Terminal, Reader, ISdkManagedPaymentIntent } from "@stripe/terminal-js";
import saladBowl from "@/assets/salad-bowl.jpg";
import logo from "@/assets/logo-fresh-and-go.png";
import {
  fetchConnectionToken,
  createPaymentIntent,
} from "@/lib/stripe-server";
import { PRODUCTS, type CartItem } from "@/lib/products";

export const Route = createFileRoute("/")({
  component: Kiosk,
});

// ─── Constantes ────────────────────────────────────────────────────────────
const PRICE_PER_G = 0.0289;
const TPS_RATE = 0.05;
const TVQ_RATE = 0.09975;

/** Mettre à false quand un vrai lecteur de carte est branché */
const USE_SIMULATED_READER = true;

/**
 * Délai max (ms) entre deux caractères d'un même scan.
 * Scanneur USB physique : < 50 ms par caractère.
 * Barcode to PC (app) : jusqu'à ~300 ms selon les réglages.
 * → 400 ms est suffisamment grand pour capturer les deux,
 *   tout en étant bien inférieur à la frappe humaine (> 600 ms/caractère
 *   pour taper un code EAN-13 entier).
 */
const SCAN_CHAR_TIMEOUT = 400;

// ─── Types ─────────────────────────────────────────────────────────────────
type Lang = "fr" | "en";
type PaymentState =
  | "idle"        // écran normal
  | "connecting"  // connexion au terminal Stripe en cours
  | "collecting"  // le lecteur attend la carte du client
  | "processing"  // traitement bancaire
  | "error";      // paiement refusé ou erreur

type ScanFeedback =
  | { kind: "ok";      barcode: string; name: string }
  | { kind: "unknown"; barcode: string }
  | null;

// ─── Traductions ───────────────────────────────────────────────────────────
const TRANSLATIONS = {
  fr: {
    connected: "Balance connectée",
    place: "Déposez votre bol sur la balance…",
    weight: "Poids",
    price: "Prix",
    simulate: "— Simuler la balance —",
    simulateAria: "Simuler le poids",
    pay: "Payer",
    thanks: "Merci !",
    enjoy: "Bon appétit",
    totalPaid: "Total payé",
    restart: "Nouvelle pesée",
    cancel: "Annuler",
    credit: "Crédit",
    subtotal: "Sous-total",
    saladLine: "Salade",
    drinksLine: "Boissons",
    tps: "TPS (5 %)",
    tvq: "TVQ (9,975 %)",
    total: "Total",
    // Paiement Stripe Terminal
    connecting: "Connexion au terminal…",
    collectingTitle: "Présentez votre carte",
    collectingSub: "Insérez, glissez ou approchez votre carte",
    processing: "Traitement en cours…",
    paymentError: "Paiement refusé",
    retry: "Réessayer",
    noReader: "Aucun lecteur trouvé",
    readerDisconnected: "Lecteur déconnecté",
    autoReturn: "Retour automatique dans",
    seconds: "s",
    // Scanner boissons
    drinksTitle: "Boissons",
    scanHint: "Scannez une boisson pour l'ajouter",
    unknownCode: "Code-barres inconnu",
    scanned: "Ajouté",
    qty: "Qté",
    manualBtn: "+ Entrer un code-barres",
    manualPlaceholder: "Ex : 4902102141673",
    manualAdd: "Ajouter",
    manualCancel: "Annuler",
    cameraBtn: "Caméra",
    cameraHint: "Pointez vers le code-barres",
    cameraClose: "Fermer",
    cameraUnsupported: "Caméra non supportée par ce navigateur",
  },
  en: {
    connected: "Scale connected",
    place: "Place your bowl on the scale…",
    weight: "Weight",
    price: "Price",
    simulate: "— Simulate the scale —",
    simulateAria: "Simulate weight",
    pay: "Pay",
    thanks: "Thank you!",
    enjoy: "Enjoy your meal",
    totalPaid: "Total paid",
    restart: "New weighing",
    cancel: "Cancel",
    credit: "Credit",
    subtotal: "Subtotal",
    saladLine: "Salad",
    drinksLine: "Beverages",
    tps: "GST (5%)",
    tvq: "QST (9.975%)",
    total: "Total",
    // Stripe Terminal payment
    connecting: "Connecting to terminal…",
    collectingTitle: "Present your card",
    collectingSub: "Insert, swipe, or tap your card",
    processing: "Processing…",
    paymentError: "Payment declined",
    retry: "Try again",
    noReader: "No reader found",
    readerDisconnected: "Reader disconnected",
    autoReturn: "Automatic return in",
    seconds: "s",
    // Beverage scanner
    drinksTitle: "Beverages",
    scanHint: "Scan a beverage to add it",
    unknownCode: "Unknown barcode",
    scanned: "Added",
    qty: "Qty",
    manualBtn: "+ Enter a barcode",
    manualPlaceholder: "e.g. 4902102141673",
    manualAdd: "Add",
    manualCancel: "Cancel",
    cameraBtn: "Camera",
    cameraHint: "Point at the barcode",
    cameraClose: "Close",
    cameraUnsupported: "Camera not supported by this browser",
  },
} as const;

// ─── Composant principal ───────────────────────────────────────────────────
function Kiosk() {
  // ── État balance & UI ────────────────────────────────────────────────────
  const [weight, setWeight] = useState(0);
  const [paid, setPaid] = useState(false);
  const [lang, setLang] = useState<Lang>("fr");

  // ── Panier boissons ──────────────────────────────────────────────────────
  const [cart, setCart] = useState<CartItem[]>([]);
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback>(null);

  // ── Saisie manuelle du code-barres ───────────────────────────────────────
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const manualInputRef = useRef<HTMLInputElement>(null);

  // ── Caméra scanner ───────────────────────────────────────────────────────
  const [showCamera, setShowCamera] = useState(false);

  // ── État paiement Stripe ─────────────────────────────────────────────────
  const [paymentState, setPaymentState] = useState<PaymentState>("idle");
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // ── Décompte retour automatique ──────────────────────────────────────────
  const [countdown, setCountdown] = useState(5);

  // ── Références Terminal Stripe (singleton par session) ───────────────────
  const terminalRef = useRef<Terminal | null>(null);
  const readerRef = useRef<Reader | null>(null);

  // ── Références scanner code-barres ──────────────────────────────────────
  const barcodeBufferRef = useRef("");
  const lastKeyTimeRef = useRef(0);
  /**
   * Timer ID du verrou scanner (null = pas de verrou actif).
   * Stratégie "silence-based" : le verrou se libère 600 ms APRÈS
   * la dernière frappe reçue du scanner (chiffre ou Enter).
   * Tant que le scanner continue d'envoyer des touches, on repousse
   * le timer → le verrou reste actif indéfiniment.
   * Dès que le scanner s'arrête, 600 ms s'écoulent et le verrou tombe.
   */
  const scanLockRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const t = TRANSLATIONS[lang];

  // ─── Calculs prix ──────────────────────────────────────────────────────
  const saladSubtotal = weight * PRICE_PER_G;
  const cartSubtotal = cart.reduce(
    (sum, item) => sum + item.priceCad * item.quantity,
    0,
  );
  const subtotal = saladSubtotal + cartSubtotal;
  const tps = subtotal * TPS_RATE;
  const tvq = subtotal * TVQ_RATE;
  const price = subtotal + tps + tvq;
  const amountCents = Math.round(price * 100);

  const fmt = (n: number) =>
    lang === "fr" ? n.toFixed(2).replace(".", ",") : n.toFixed(2);
  const priceStr = fmt(price);
  const currency = "$";

  // ─── Reset complet ──────────────────────────────────────────────────────
  const reset = () => {
    setWeight(0);
    setPaid(false);
    setPaymentState("idle");
    setPaymentError(null);
    setCountdown(5);
    setCart([]);
    setScanFeedback(null);
    setShowManualInput(false);
    setManualCode("");
    setShowCamera(false);
  };

  // ─── Scanner : ajouter ou incrémenter un produit ────────────────────────
  // ⚠️ Doit être défini AVANT closeCamera et openCamera (SSR hook order)
  const handleBarcodeScan = useCallback((barcode: string) => {
    // ── Verrou "silence-based" ─────────────────────────────────────────────
    // Si le verrou est actif, le scanner envoie encore → on repousse le timer
    // de 600 ms et on ignore ce scan.
    // Si le verrou est inactif, on l'active pour 600 ms (sera repoussé par
    // chaque frappe suivante reçue dans le keydown handler).
    if (scanLockRef.current !== null) {
      clearTimeout(scanLockRef.current);
      scanLockRef.current = setTimeout(() => { scanLockRef.current = null; }, 600);
      console.debug("[Scanner] Verrou actif — scan ignoré :", barcode);
      return;
    }
    scanLockRef.current = setTimeout(() => { scanLockRef.current = null; }, 600);

    const product = PRODUCTS[barcode];

    if (!product) {
      setScanFeedback({ kind: "unknown", barcode });
      setTimeout(() => setScanFeedback(null), 2000);
      return;
    }

    setCart((prev) => {
      const existing = prev.find((item) => item.barcode === barcode);
      if (existing) {
        return prev.map((item) =>
          item.barcode === barcode
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      }
      return [...prev, { ...product, quantity: 1 }];
    });

    setScanFeedback({
      kind: "ok",
      barcode,
      name: lang === "fr" ? product.nameFr : product.nameEn,
    });
    setTimeout(() => setScanFeedback(null), 1800);
  }, [lang]);

  // ─── Ouvrir la saisie manuelle et focaliser le champ ───────────────────
  const openManualInput = () => {
    setShowManualInput(true);
    setTimeout(() => manualInputRef.current?.focus(), 50);
  };

  // ─── Soumettre un code-barres saisi à la main ──────────────────────────
  const submitManualCode = () => {
    const code = manualCode.trim();
    if (code.length >= 4) {
      handleBarcodeScan(code);
    }
    setManualCode("");
    setShowManualInput(false);
  };

  // ─── Fermer la caméra ──────────────────────────────────────────────────
  const closeCamera = useCallback(() => {
    setShowCamera(false);
  }, []);

  // ─── Ouvrir la caméra ──────────────────────────────────────────────────
  const openCamera = useCallback(() => {
    setShowCamera(true);
  }, []);

  // ─── Démarrer/arrêter html5-qrcode (chargé depuis CDN, jamais bundlé) ──
  useEffect(() => {
    if (!showCamera) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let scanner: any = null;
    let cancelled = false;
    let started = false;

    (async () => {
      try {
        // Charger html5-qrcode depuis CDN si pas encore en mémoire
        // → jamais inclus dans le bundle serveur, aucun crash Worker
        if (!(window as any).Html5Qrcode) {
          await new Promise<void>((resolve, reject) => {
            const s = document.createElement("script");
            s.src = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";
            s.onload = () => resolve();
            s.onerror = () => reject(new Error("CDN unreachable"));
            document.head.appendChild(s);
          });
        }

        if (cancelled) return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        scanner = new w.Html5Qrcode("fg-camera-reader", {
          formatsToSupport: [
            w.Html5QrcodeSupportedFormats.EAN_13,
            w.Html5QrcodeSupportedFormats.EAN_8,
            w.Html5QrcodeSupportedFormats.UPC_A,
            w.Html5QrcodeSupportedFormats.UPC_E,
            w.Html5QrcodeSupportedFormats.CODE_128,
            w.Html5QrcodeSupportedFormats.CODE_39,
            w.Html5QrcodeSupportedFormats.QR_CODE,
          ],
          verbose: false,
        });

        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 280, height: 120 } },
          (decoded: string) => {
            started = false;
            setShowCamera(false);
            handleBarcodeScan(decoded);
          },
          () => { /* erreurs frame par frame — ignorer */ },
        );

        started = true;
        if (cancelled) {
          started = false;
          scanner.stop().catch(() => {});
        }
      } catch {
        if (!cancelled) setShowCamera(false);
      }
    })();

    return () => {
      cancelled = true;
      if (started) {
        started = false;
        scanner?.stop().catch(() => {});
      }
    };
  }, [showCamera, handleBarcodeScan]);

  // ─── Écouter le coller (Barcode to PC mode Clipboard + Cmd+V) ──────────
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const active = document.activeElement;
      if (active?.tagName === "INPUT" || active?.tagName === "TEXTAREA") return;
      const text = e.clipboardData?.getData("text")?.trim() ?? "";
      // N'accepter que les chaînes de chiffres (codes EAN/UPC/Code128 numérique)
      if (/^\d{4,}$/.test(text)) {
        e.preventDefault();
        handleBarcodeScan(text);
      }
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handleBarcodeScan]);

  // ─── Retour automatique au menu après paiement (5 s) ───────────────────
  useEffect(() => {
    if (!paid) return;
    setCountdown(5);
    let remaining = 5;
    const id = setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(id);
        reset();
      }
    }, 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paid]);

  // ─── Scanner : écouter le clavier (HID scanner / Barcode to PC) ─────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Si un <input> ou <textarea> est actif, on laisse le clavier à l'utilisateur
      const active = document.activeElement;
      if (
        active &&
        (active.tagName === "INPUT" || active.tagName === "TEXTAREA")
      ) {
        barcodeBufferRef.current = "";
        return;
      }

      const now = Date.now();

      if (e.key === "Enter") {
        const barcode = barcodeBufferRef.current.trim();
        console.debug("[Scanner] Enter reçu, buffer =", barcode);
        if (barcode.length >= 4) {
          handleBarcodeScan(barcode);
        }
        barcodeBufferRef.current = "";
        return;
      }

      // Si trop de temps s'est écoulé depuis la dernière touche → reset buffer
      if (
        now - lastKeyTimeRef.current > SCAN_CHAR_TIMEOUT &&
        barcodeBufferRef.current.length > 0
      ) {
        console.debug("[Scanner] Timeout, buffer reset. Was:", barcodeBufferRef.current);
        barcodeBufferRef.current = "";
      }

      // N'accumuler que les chiffres (EAN / UPC)
      if (/^\d$/.test(e.key)) {
        // Si verrou actif, chaque nouveau chiffre repousse le timer de 600 ms
        // (le scanner envoie encore → on maintient le verrou)
        if (scanLockRef.current !== null) {
          clearTimeout(scanLockRef.current);
          scanLockRef.current = setTimeout(() => { scanLockRef.current = null; }, 600);
        }
        barcodeBufferRef.current += e.key;
        lastKeyTimeRef.current = now;
        console.debug("[Scanner] Buffer:", barcodeBufferRef.current);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleBarcodeScan]);

  // ─── Panier : changer la quantité d'un article ──────────────────────────
  const changeQty = (barcode: string, delta: number) => {
    setCart((prev) => {
      const updated = prev
        .map((item) =>
          item.barcode === barcode
            ? { ...item, quantity: item.quantity + delta }
            : item,
        )
        .filter((item) => item.quantity > 0);
      return updated;
    });
  };

  // ─── Stripe Terminal : initialisation (lazy, une seule fois) ───────────
  const getTerminal = async (): Promise<Terminal> => {
    if (terminalRef.current) return terminalRef.current;

    const StripeTerminal = await loadStripeTerminal();
    if (!StripeTerminal) throw new Error("Stripe Terminal SDK non disponible");

    const terminal = StripeTerminal.create({
      onFetchConnectionToken: async () => {
        const res = await fetchConnectionToken();
        return res.secret;
      },
      onUnexpectedReaderDisconnect: () => {
        readerRef.current = null;
        setPaymentState("error");
        setPaymentError(t.readerDisconnected);
      },
    });

    terminalRef.current = terminal;
    return terminal;
  };

  // ─── Stripe Terminal : connexion au lecteur (lazy, une seule fois) ─────
  const ensureReaderConnected = async (terminal: Terminal): Promise<void> => {
    if (readerRef.current) return;

    const discoverResult = await terminal.discoverReaders({
      simulated: USE_SIMULATED_READER,
    });

    if ("error" in discoverResult) {
      throw new Error(discoverResult.error.message);
    }
    if (discoverResult.discoveredReaders.length === 0) {
      throw new Error(t.noReader);
    }

    const connectResult = await terminal.connectReader(
      discoverResult.discoveredReaders[0],
    );
    if ("error" in connectResult) {
      throw new Error(connectResult.error.message);
    }

    readerRef.current = connectResult.reader;
  };

  // ─── Lancer un paiement ────────────────────────────────────────────────
  const startPayment = async () => {
    if (amountCents === 0 || paymentState !== "idle") return;

    setPaymentState("connecting");
    setPaymentError(null);

    try {
      const terminal = await getTerminal();
      await ensureReaderConnected(terminal);

      const { clientSecret } = await createPaymentIntent({ data: { amountCents } });

      setPaymentState("collecting");
      const collectResult = await terminal.collectPaymentMethod(clientSecret);
      if ("error" in collectResult) throw new Error(collectResult.error.message);

      setPaymentState("processing");
      const processResult = await terminal.processPayment(
        collectResult.paymentIntent as ISdkManagedPaymentIntent,
      );
      if ("error" in processResult) throw new Error(processResult.error.message);

      setPaid(true);
      setPaymentState("idle");
    } catch (err) {
      try {
        if (terminalRef.current) {
          await terminalRef.current.cancelCollectPaymentMethod();
        }
      } catch {
        /* ignore */
      }
      setPaymentState("error");
      setPaymentError(err instanceof Error ? err.message : t.paymentError);
    }
  };

  // ─── Annuler pendant la collecte ───────────────────────────────────────
  const cancelPayment = async () => {
    try {
      if (terminalRef.current) {
        await terminalRef.current.cancelCollectPaymentMethod();
      }
    } catch {
      /* ignore */
    }
    setPaymentState("idle");
    setPaymentError(null);
  };

  const isPaymentInProgress =
    paymentState === "connecting" ||
    paymentState === "collecting" ||
    paymentState === "processing";

  const canPay = amountCents > 0 && !isPaymentInProgress;

  // ════════════════════════════════════════════════════════════════════════
  // RENDU
  // ════════════════════════════════════════════════════════════════════════
  return (
    <main className="h-dvh overflow-hidden bg-white flex font-sans">
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-white">

        {/* ══════════════════════════════════════════
            HEADER
        ══════════════════════════════════════════ */}
        <header
          className="shrink-0 bg-[#E05A1E] flex items-center
                     px-[clamp(10px,3vw,56px)]
                     py-[clamp(6px,1.5vh,18px)]"
          style={{ minHeight: "clamp(64px, 18dvh, 280px)" }}
        >
          {/* Mobile (< sm) */}
          <div className="sm:hidden flex flex-col items-center w-full gap-2">
            <img
              src={logo}
              alt="Fresh & Go"
              style={{ height: "clamp(28px, 7dvh, 70px)" }}
              className="w-auto object-contain"
            />
            <div className="flex w-full items-center justify-between gap-2">
              <div
                className="flex items-center gap-2 bg-white/20
                           font-semibold text-white whitespace-nowrap px-3 py-1.5"
                style={{ fontSize: "clamp(10px, 2.5vw, 15px)" }}
              >
                <span className="h-2 w-2 rounded-full bg-[#7FD96A] animate-pulse shrink-0" />
                {t.connected}
              </div>
              <div
                role="group"
                aria-label="Language"
                className="flex items-center bg-white/20 p-0.5 font-semibold text-white shrink-0"
                style={{ fontSize: "clamp(10px, 2.5vw, 14px)" }}
              >
                {(["fr", "en"] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLang(l)}
                    className={`px-3 py-1 uppercase transition-colors
                      ${lang === l ? "bg-white text-[#E05A1E]" : "hover:bg-white/10"}`}
                    aria-pressed={lang === l}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* sm+ : grille 3 colonnes */}
          <div className="hidden sm:grid grid-cols-[1fr_auto_1fr] items-center w-full gap-4">
            <div
              className="justify-self-start flex items-center gap-[clamp(6px,1vw,20px)]
                         bg-white/20 font-semibold text-white whitespace-nowrap
                         px-[clamp(12px,2vw,44px)]"
              style={{
                height: "clamp(36px, 7dvh, 98px)",
                fontSize: "clamp(11px, 1.6vw, 32px)",
              }}
            >
              <span
                style={{
                  width: "clamp(8px,1vw,20px)",
                  height: "clamp(8px,1vw,20px)",
                }}
                className="rounded-full bg-[#7FD96A] animate-pulse shrink-0"
              />
              {t.connected}
            </div>

            <img
              src={logo}
              alt="Fresh & Go"
              style={{ height: "clamp(40px, 11dvh, 160px)" }}
              className="w-auto object-contain justify-self-center"
            />

            <div
              role="group"
              aria-label="Language"
              className="justify-self-end flex items-center bg-white/20
                         p-[clamp(3px,0.4vw,8px)] font-semibold text-white"
              style={{
                height: "clamp(38px, 7.5dvh, 108px)",
                fontSize: "clamp(11px, 1.6vw, 32px)",
              }}
            >
              {(["fr", "en"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  style={{
                    height: "clamp(30px, 6dvh, 88px)",
                    minWidth: "clamp(44px, 5vw, 120px)",
                    fontSize: "clamp(11px, 1.6vw, 32px)",
                  }}
                  className={`px-[clamp(8px,1.5vw,32px)] uppercase transition-colors
                    ${lang === l ? "bg-white text-[#E05A1E]" : "hover:bg-white/10"}`}
                  aria-pressed={lang === l}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </header>

        {/* ══════════════════════════════════════════
            CONTENU
        ══════════════════════════════════════════ */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">

          {/* ── Toast feedback scan (flottant) ── */}
          {scanFeedback && (
            <div
              className={`absolute top-2 left-1/2 -translate-x-1/2 z-50
                          flex items-center gap-2 px-4 py-2 shadow-lg
                          transition-all duration-300
                          ${scanFeedback.kind === "ok"
                            ? "bg-[#4A8C2A] text-white"
                            : "bg-red-600 text-white"
                          }`}
              style={{ fontSize: "clamp(11px, 1.8dvh, 16px)" }}
            >
              {scanFeedback.kind === "ok" ? (
                <>
                  <Check style={{ width: 16, height: 16 }} strokeWidth={3} />
                  <span>{t.scanned} — {scanFeedback.name}</span>
                </>
              ) : (
                <>
                  <AlertCircle style={{ width: 16, height: 16 }} />
                  <span>{t.unknownCode} : {scanFeedback.barcode}</span>
                </>
              )}
            </div>
          )}

          {/* ── Écran de succès ── */}
          {paid ? (
            <div className="flex-1 flex flex-col items-center justify-center
                            text-center px-4 py-4 gap-[clamp(8px,2dvh,32px)]">
              <div
                className="flex items-center justify-center bg-[#4A8C2A]"
                style={{
                  width: "clamp(52px,10dvh,96px)",
                  height: "clamp(52px,10dvh,96px)",
                }}
              >
                <Check
                  style={{
                    width: "clamp(26px,5dvh,48px)",
                    height: "clamp(26px,5dvh,48px)",
                  }}
                  className="text-white"
                  strokeWidth={3}
                />
              </div>
              <div
                style={{ fontSize: "clamp(20px,4dvh,48px)" }}
                className="font-medium text-[#27500A]"
              >
                {t.thanks}
              </div>
              <div
                style={{ fontSize: "clamp(12px,2dvh,20px)" }}
                className="text-muted-foreground"
              >
                {t.enjoy}
              </div>
              <div
                className="w-full max-w-[min(400px,80vw)]
                           border-[1.5px] border-[#4A8C2A] bg-[#F0F8E8]
                           px-[clamp(12px,3vw,32px)] py-[clamp(10px,2dvh,24px)]"
              >
                <div
                  style={{ fontSize: "clamp(10px,1.5dvh,14px)" }}
                  className="text-[#3B6D11]"
                >
                  {t.totalPaid}
                </div>
                <div
                  style={{ fontSize: "clamp(32px,7dvh,72px)" }}
                  className="font-medium text-[#27500A]"
                >
                  {priceStr} {currency}
                </div>
              </div>
              <button
                onClick={reset}
                style={{ fontSize: "clamp(13px,2dvh,22px)" }}
                className="w-full max-w-[min(400px,80vw)]
                           border-[1.5px] border-[#E05A1E]
                           py-[clamp(10px,2dvh,24px)]
                           text-[#E05A1E] transition-colors hover:bg-[#FFF4EE]"
              >
                {t.restart}
              </button>

              {/* Décompte retour automatique */}
              <div className="w-full max-w-[min(400px,80vw)] flex flex-col items-center gap-[clamp(4px,0.8dvh,10px)]">
                <span
                  style={{ fontSize: "clamp(10px,1.5dvh,14px)" }}
                  className="text-muted-foreground"
                >
                  {t.autoReturn}&nbsp;
                  <span className="font-semibold text-[#E05A1E]">
                    {countdown}{t.seconds}
                  </span>
                </span>
                <div className="w-full h-1 bg-[#F0EDE8] overflow-hidden">
                  <div
                    className="h-full bg-[#E05A1E] transition-all duration-1000 ease-linear"
                    style={{ width: `${(countdown / 5) * 100}%` }}
                  />
                </div>
              </div>
            </div>

          /* ── Écran de collecte (client présente sa carte) ── */
          ) : paymentState === "collecting" || paymentState === "processing" ? (
            <div className="flex-1 flex flex-col items-center justify-center
                            gap-[clamp(16px,3dvh,48px)]
                            px-[clamp(16px,4vw,64px)]">
              <div
                className="flex items-center justify-center bg-[#E05A1E]"
                style={{
                  width: "clamp(64px,12dvh,120px)",
                  height: "clamp(64px,12dvh,120px)",
                }}
              >
                {paymentState === "processing" ? (
                  <Loader2
                    className="text-white animate-spin"
                    style={{
                      width: "clamp(32px,6dvh,60px)",
                      height: "clamp(32px,6dvh,60px)",
                    }}
                  />
                ) : (
                  <CreditCard
                    className="text-white"
                    style={{
                      width: "clamp(32px,6dvh,60px)",
                      height: "clamp(32px,6dvh,60px)",
                    }}
                  />
                )}
              </div>

              <div className="text-center">
                <div
                  className="font-semibold text-[#1a1a1a]"
                  style={{ fontSize: "clamp(20px,4dvh,52px)" }}
                >
                  {paymentState === "processing"
                    ? t.processing
                    : t.collectingTitle}
                </div>
                {paymentState === "collecting" && (
                  <div
                    className="text-muted-foreground mt-[clamp(4px,1dvh,12px)]"
                    style={{ fontSize: "clamp(12px,2dvh,24px)" }}
                  >
                    {t.collectingSub}
                  </div>
                )}
              </div>

              <div
                className="border-[1.5px] border-[#4A8C2A] bg-[#F0F8E8]
                           px-[clamp(24px,5vw,64px)] py-[clamp(12px,2dvh,32px)]"
              >
                <div
                  style={{ fontSize: "clamp(36px,8dvh,96px)" }}
                  className="font-medium text-[#27500A] text-center"
                >
                  {priceStr} {currency}
                </div>
              </div>

              {paymentState === "collecting" && (
                <button
                  onClick={cancelPayment}
                  style={{
                    fontSize: "clamp(13px,2dvh,22px)",
                    paddingTop: "clamp(10px,2dvh,24px)",
                    paddingBottom: "clamp(10px,2dvh,24px)",
                  }}
                  className="w-full max-w-[min(400px,80vw)]
                             border-[1.5px] border-[#E05A1E] text-[#E05A1E]
                             transition-colors hover:bg-[#FFF4EE]"
                >
                  {t.cancel}
                </button>
              )}
            </div>

          /* ── Écran d'erreur ── */
          ) : paymentState === "error" ? (
            <div className="flex-1 flex flex-col items-center justify-center
                            gap-[clamp(16px,3dvh,48px)]
                            px-[clamp(16px,4vw,64px)]">
              <div
                className="flex items-center justify-center bg-red-600"
                style={{
                  width: "clamp(64px,12dvh,120px)",
                  height: "clamp(64px,12dvh,120px)",
                }}
              >
                <AlertCircle
                  className="text-white"
                  style={{
                    width: "clamp(32px,6dvh,60px)",
                    height: "clamp(32px,6dvh,60px)",
                  }}
                />
              </div>

              <div className="text-center">
                <div
                  className="font-semibold text-red-700"
                  style={{ fontSize: "clamp(18px,3.5dvh,44px)" }}
                >
                  {t.paymentError}
                </div>
                {paymentError && (
                  <div
                    className="text-muted-foreground mt-[clamp(4px,1dvh,12px)]"
                    style={{ fontSize: "clamp(11px,1.8dvh,20px)" }}
                  >
                    {paymentError}
                  </div>
                )}
              </div>

              <div className="flex flex-col w-full max-w-[min(400px,80vw)] gap-[clamp(8px,1.5dvh,20px)]">
                <button
                  onClick={() => { setPaymentState("idle"); setPaymentError(null); }}
                  style={{
                    fontSize: "clamp(13px,2dvh,22px)",
                    paddingTop: "clamp(10px,2dvh,24px)",
                    paddingBottom: "clamp(10px,2dvh,24px)",
                  }}
                  className="w-full bg-[#E05A1E] font-medium text-white
                             transition-colors hover:bg-[#C04010]"
                >
                  {t.retry}
                </button>
                <button
                  onClick={reset}
                  style={{
                    fontSize: "clamp(13px,2dvh,22px)",
                    paddingTop: "clamp(10px,2dvh,24px)",
                    paddingBottom: "clamp(10px,2dvh,24px)",
                  }}
                  className="w-full border-[1.5px] border-[#E05A1E] text-[#E05A1E]
                             transition-colors hover:bg-[#FFF4EE]"
                >
                  {t.cancel}
                </button>
              </div>
            </div>

          /* ── Écran normal (idle / connecting) ── */
          ) : (
            <>
              {/* Image salade */}
              <div
                className="flex-1 min-h-0 flex items-center justify-center
                           px-[clamp(8px,3vw,40px)]
                           pt-[clamp(6px,1.5dvh,24px)]
                           pb-[clamp(4px,1dvh,12px)]"
              >
                <img
                  src={saladBowl}
                  alt="Fresh & Go salad bowl"
                  className="max-h-full max-w-full object-contain"
                />
              </div>

              {/* Invite balance vide (sans boissons non plus) */}
              {weight === 0 && cart.length === 0 && (
                <p
                  style={{ fontSize: "clamp(11px,2vw,22px)" }}
                  className="shrink-0 text-center text-muted-foreground
                             px-4 py-[clamp(4px,1dvh,12px)]"
                >
                  {t.place}
                </p>
              )}

              {/* Cartes Poids / Prix */}
              {(weight > 0 || cart.length > 0) && (
                <div
                  className="shrink-0 flex justify-center
                             gap-[clamp(8px,2vw,20px)]
                             px-[clamp(8px,3vw,40px)]
                             py-[clamp(4px,1dvh,12px)]"
                >
                  {weight > 0 && (
                    <div
                      className="flex-1 max-w-[clamp(110px,18vw,220px)]
                                 border-[1.5px] border-[#E05A1E] bg-[#FFF4EE]
                                 px-[clamp(8px,1.5vw,28px)] py-[clamp(6px,1dvh,20px)]"
                    >
                      <div
                        style={{ fontSize: "clamp(9px,1.2vw,13px)" }}
                        className="font-medium uppercase tracking-wider text-[#A03A10] mb-1"
                      >
                        {t.weight}
                      </div>
                      <div
                        style={{ fontSize: "clamp(20px,4vw,52px)" }}
                        className="font-medium leading-none text-[#C04010]"
                      >
                        {weight}
                        <span
                          style={{ fontSize: "clamp(10px,1.5vw,18px)" }}
                          className="ml-1"
                        >
                          g
                        </span>
                      </div>
                    </div>
                  )}
                  <div
                    className="flex-1 max-w-[clamp(110px,18vw,220px)]
                               border-[1.5px] border-[#4A8C2A] bg-[#F0F8E8]
                               px-[clamp(8px,1.5vw,28px)] py-[clamp(6px,1dvh,20px)]"
                  >
                    <div
                      style={{ fontSize: "clamp(9px,1.2vw,13px)" }}
                      className="font-medium uppercase tracking-wider text-[#3B6D11] mb-1"
                    >
                      {t.price}
                    </div>
                    <div
                      style={{ fontSize: "clamp(20px,4vw,52px)" }}
                      className="font-medium leading-none text-[#27500A]"
                    >
                      {fmt(subtotal)}
                      <span
                        style={{ fontSize: "clamp(10px,1.5vw,18px)" }}
                        className="ml-1"
                      >
                        {currency}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Section boissons scannées ── */}
              {cart.length > 0 && (
                <div
                  className="shrink-0 mx-auto w-full max-w-[min(400px,90vw)]
                             px-[clamp(8px,3vw,40px)] pb-[clamp(2px,0.5dvh,6px)]"
                >
                  <div className="border border-[#4A8C2A] bg-[#F0F8E8]">
                    {/* En-tête */}
                    <div
                      className="flex items-center gap-2 px-[clamp(10px,2vw,20px)] py-[clamp(5px,1dvh,12px)]
                                 border-b border-[#4A8C2A] bg-[#4A8C2A]"
                    >
                      <ScanLine
                        className="text-white shrink-0"
                        style={{ width: "clamp(12px,1.6vw,18px)", height: "clamp(12px,1.6vw,18px)" }}
                      />
                      <span
                        className="font-semibold text-white flex-1"
                        style={{ fontSize: "clamp(10px,1.4vw,15px)" }}
                      >
                        {t.drinksTitle}
                      </span>
                      <span
                        className="text-white/80"
                        style={{ fontSize: "clamp(10px,1.4vw,14px)" }}
                      >
                        {fmt(cartSubtotal)} {currency}
                      </span>
                    </div>

                    {/* Lignes produits */}
                    {cart.map((item) => (
                      <div
                        key={item.barcode}
                        className="flex items-center gap-2
                                   px-[clamp(10px,2vw,20px)] py-[clamp(4px,0.8dvh,10px)]
                                   border-b border-[#CDEEC0] last:border-b-0"
                        style={{ fontSize: "clamp(10px,1.4vw,14px)" }}
                      >
                        {/* Nom */}
                        <span className="flex-1 text-[#27500A] leading-tight">
                          {lang === "fr" ? item.nameFr : item.nameEn}
                        </span>

                        {/* Contrôles quantité */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => changeQty(item.barcode, -1)}
                            className="flex items-center justify-center
                                       bg-white border border-[#4A8C2A] text-[#4A8C2A]
                                       hover:bg-[#4A8C2A] hover:text-white transition-colors"
                            style={{ width: "clamp(18px,2.2vw,26px)", height: "clamp(18px,2.2vw,26px)" }}
                            aria-label="Réduire"
                          >
                            <Minus style={{ width: "clamp(8px,1vw,12px)", height: "clamp(8px,1vw,12px)" }} />
                          </button>
                          <span
                            className="font-semibold text-[#27500A] w-5 text-center"
                            style={{ fontSize: "clamp(10px,1.4vw,14px)" }}
                          >
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => changeQty(item.barcode, +1)}
                            className="flex items-center justify-center
                                       bg-white border border-[#4A8C2A] text-[#4A8C2A]
                                       hover:bg-[#4A8C2A] hover:text-white transition-colors"
                            style={{ width: "clamp(18px,2.2vw,26px)", height: "clamp(18px,2.2vw,26px)" }}
                            aria-label="Augmenter"
                          >
                            <Plus style={{ width: "clamp(8px,1vw,12px)", height: "clamp(8px,1vw,12px)" }} />
                          </button>
                        </div>

                        {/* Prix ligne */}
                        <span
                          className="text-[#27500A] font-medium w-[clamp(44px,5vw,64px)] text-right shrink-0"
                          style={{ fontSize: "clamp(10px,1.4vw,14px)" }}
                        >
                          {fmt(item.priceCad * item.quantity)} {currency}
                        </span>

                        {/* Supprimer */}
                        <button
                          onClick={() =>
                            setCart((prev) =>
                              prev.filter((i) => i.barcode !== item.barcode),
                            )
                          }
                          className="shrink-0 text-[#A0A0A0] hover:text-red-500 transition-colors ml-1"
                          aria-label="Supprimer"
                        >
                          <X style={{ width: "clamp(10px,1.2vw,16px)", height: "clamp(10px,1.2vw,16px)" }} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Saisie manuelle code-barres ── */}
              <div
                className="shrink-0 mx-auto w-full max-w-[min(400px,90vw)]
                           px-[clamp(8px,3vw,40px)] pb-[clamp(2px,0.5dvh,6px)]"
              >
                {!showManualInput ? (
                  /* Boutons : manuel + caméra */
                  <div className="flex gap-2">
                    <button
                      onClick={openManualInput}
                      disabled={isPaymentInProgress}
                      className="flex-1 flex items-center justify-center gap-2
                                 border border-dashed border-[#4A8C2A] text-[#4A8C2A]
                                 bg-transparent hover:bg-[#F0F8E8] transition-colors
                                 disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{
                        fontSize: "clamp(10px,1.4vw,14px)",
                        padding: "clamp(6px,1dvh,12px) 0",
                      }}
                    >
                      <Keyboard style={{ width: "clamp(12px,1.5vw,16px)", height: "clamp(12px,1.5vw,16px)" }} />
                      {t.manualBtn}
                    </button>
                    <button
                      onClick={openCamera}
                      disabled={isPaymentInProgress}
                      className="flex items-center justify-center gap-2
                                 border border-dashed border-[#4A8C2A] text-[#4A8C2A]
                                 bg-transparent hover:bg-[#F0F8E8] transition-colors
                                 disabled:opacity-40 disabled:cursor-not-allowed
                                 px-[clamp(10px,2vw,20px)]"
                      style={{
                        fontSize: "clamp(10px,1.4vw,14px)",
                        padding: "clamp(6px,1dvh,12px) clamp(10px,2vw,20px)",
                      }}
                    >
                      <Camera style={{ width: "clamp(12px,1.5vw,16px)", height: "clamp(12px,1.5vw,16px)" }} />
                      {t.cameraBtn}
                    </button>
                  </div>
                ) : (
                  /* Formulaire inline */
                  <div className="flex gap-2 items-stretch">
                    <input
                      ref={manualInputRef}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={manualCode}
                      onChange={(e) => setManualCode(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitManualCode();
                        if (e.key === "Escape") {
                          setShowManualInput(false);
                          setManualCode("");
                        }
                      }}
                      placeholder={t.manualPlaceholder}
                      className="flex-1 border border-[#4A8C2A] px-3 outline-none
                                 focus:ring-1 focus:ring-[#4A8C2A] bg-white text-[#27500A]
                                 placeholder:text-[#AACCA0]"
                      style={{ fontSize: "clamp(11px,1.5vw,15px)" }}
                    />
                    <button
                      onClick={submitManualCode}
                      disabled={manualCode.trim().length < 4}
                      className="shrink-0 bg-[#4A8C2A] text-white font-medium
                                 hover:bg-[#3A7020] transition-colors
                                 disabled:opacity-40 disabled:cursor-not-allowed px-4"
                      style={{ fontSize: "clamp(10px,1.4vw,14px)" }}
                    >
                      {t.manualAdd}
                    </button>
                    <button
                      onClick={() => { setShowManualInput(false); setManualCode(""); }}
                      className="shrink-0 border border-[#E8E8E4] text-[#888] hover:bg-[#F8F8F8] transition-colors px-3"
                      style={{ fontSize: "clamp(10px,1.4vw,14px)" }}
                    >
                      {t.manualCancel}
                    </button>
                  </div>
                )}
              </div>

              {/* Tableau taxes */}
              {(weight > 0 || cart.length > 0) && (
                <div
                  className="shrink-0 mx-auto w-full max-w-[min(400px,90vw)]
                             px-[clamp(8px,3vw,40px)] pb-[clamp(2px,0.5dvh,8px)]"
                >
                  <div
                    className="border border-[#E8E8E4] bg-[#FAFAF7]
                               px-[clamp(10px,2vw,24px)] py-[clamp(6px,1dvh,16px)]"
                    style={{ fontSize: "clamp(10px,1.4vw,15px)" }}
                  >
                    {/* Salade (si pesée) */}
                    {weight > 0 && cart.length > 0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>{t.saladLine}</span>
                        <span>{fmt(saladSubtotal)} {currency}</span>
                      </div>
                    )}
                    {/* Boissons (si scannées) */}
                    {cart.length > 0 && weight > 0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>{t.drinksLine}</span>
                        <span>{fmt(cartSubtotal)} {currency}</span>
                      </div>
                    )}
                    {/* Sous-total avant taxes */}
                    <div className={`flex justify-between text-muted-foreground ${(weight > 0 && cart.length > 0) ? "mt-1" : ""}`}>
                      <span>{t.subtotal}</span>
                      <span>{fmt(subtotal)} {currency}</span>
                    </div>
                    <div className="mt-1 flex justify-between text-muted-foreground">
                      <span>{t.tps}</span>
                      <span>{fmt(tps)} {currency}</span>
                    </div>
                    <div className="mt-1 flex justify-between text-muted-foreground">
                      <span>{t.tvq}</span>
                      <span>{fmt(tvq)} {currency}</span>
                    </div>
                    <div
                      className="mt-2 flex justify-between border-t border-[#E8E8E4] pt-2
                                 font-semibold text-[#27500A]"
                      style={{ fontSize: "clamp(11px,1.6vw,18px)" }}
                    >
                      <span>{t.total}</span>
                      <span>{priceStr} {currency}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Simulateur de balance */}
              <div className="shrink-0 px-[clamp(8px,3vw,40px)] py-[clamp(4px,0.8dvh,10px)]">
                <p
                  style={{ fontSize: "clamp(9px,1.2vw,13px)" }}
                  className="mb-1 text-center text-muted-foreground"
                >
                  {t.simulate}
                </p>
                <input
                  type="range"
                  min={0}
                  max={600}
                  step={10}
                  value={weight}
                  onChange={(e) => setWeight(parseInt(e.target.value))}
                  className="w-full accent-[#E05A1E] cursor-pointer"
                  style={{ height: "clamp(6px,1dvh,12px)" }}
                  aria-label={t.simulateAria}
                />
              </div>

              {/* Boutons de paiement */}
              <div
                className="shrink-0
                           px-[clamp(8px,3vw,40px)]
                           pb-[clamp(8px,2dvh,28px)]
                           pt-[clamp(4px,0.8dvh,12px)]"
              >
                <button
                  disabled={!canPay}
                  onClick={startPayment}
                  style={{
                    paddingTop: "clamp(8px,1.8dvh,24px)",
                    paddingBottom: "clamp(8px,1.8dvh,24px)",
                    fontSize: "clamp(14px,2.2vw,28px)",
                  }}
                  className="w-full bg-[#E05A1E] font-medium text-white
                             tracking-tight transition-colors
                             hover:bg-[#C04010] active:bg-[#A03000]
                             disabled:cursor-not-allowed disabled:bg-[#E8E8E4] disabled:text-[#ACACAC]
                             flex items-center justify-center gap-3"
                >
                  {paymentState === "connecting" ? (
                    <>
                      <Loader2
                        className="animate-spin"
                        style={{
                          width: "clamp(14px,2vw,24px)",
                          height: "clamp(14px,2vw,24px)",
                        }}
                      />
                      {t.connecting}
                    </>
                  ) : amountCents === 0 ? (
                    t.pay
                  ) : (
                    `${t.pay} ${priceStr} ${currency}`
                  )}
                </button>

                <button
                  disabled={isPaymentInProgress}
                  onClick={reset}
                  style={{
                    marginTop: "clamp(6px,1dvh,16px)",
                    paddingTop: "clamp(8px,1.8dvh,24px)",
                    paddingBottom: "clamp(8px,1.8dvh,24px)",
                    fontSize: "clamp(14px,2.2vw,28px)",
                  }}
                  className="w-full border-[1.5px] border-[#E05A1E] bg-white
                             font-medium text-[#E05A1E] tracking-tight transition-colors
                             hover:bg-[#FFF4EE] active:bg-[#FFE8DC]
                             disabled:cursor-not-allowed disabled:border-[#E8E8E4] disabled:text-[#ACACAC]"
                >
                  {t.cancel}
                </button>

                <div
                  className="flex flex-wrap justify-center text-muted-foreground
                             gap-[clamp(10px,2vw,32px)]
                             mt-[clamp(6px,1dvh,16px)]"
                  style={{ fontSize: "clamp(9px,1.2vw,14px)" }}
                >
                  <span className="flex items-center gap-1">
                    <CreditCard
                      style={{
                        width: "clamp(12px,1.5vw,20px)",
                        height: "clamp(12px,1.5vw,20px)",
                      }}
                    />
                    Interac
                  </span>
                  <span className="flex items-center gap-1">
                    <CreditCard
                      style={{
                        width: "clamp(12px,1.5vw,20px)",
                        height: "clamp(12px,1.5vw,20px)",
                      }}
                    />
                    {t.credit}
                  </span>
                  <span className="flex items-center gap-1">
                    <Smartphone
                      style={{
                        width: "clamp(12px,1.5vw,20px)",
                        height: "clamp(12px,1.5vw,20px)",
                      }}
                    />
                    Apple/Google Pay
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════
          MODALE CAMÉRA — html5-qrcode
      ══════════════════════════════════════════ */}
      {showCamera && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center gap-[clamp(12px,2dvh,28px)]">
          <p
            className="text-white font-semibold"
            style={{ fontSize: "clamp(14px,2vw,20px)" }}
          >
            {t.cameraHint}
          </p>

          {/* html5-qrcode injecte la vidéo dans ce div */}
          <div
            id="fg-camera-reader"
            style={{ width: "min(90vw, 420px)" }}
          />

          <button
            onClick={closeCamera}
            className="flex items-center gap-2 border border-white/40 text-white
                       hover:bg-white/10 transition-colors
                       px-[clamp(24px,4vw,48px)] py-[clamp(10px,1.8dvh,20px)]"
            style={{ fontSize: "clamp(13px,1.8vw,18px)" }}
          >
            <X style={{ width: 16, height: 16 }} />
            {t.cameraClose}
          </button>
        </div>
      )}
    </main>
  );
}
