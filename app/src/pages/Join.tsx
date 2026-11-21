import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Download, ExternalLink, MessageCircle, ShieldCheck } from "lucide-react";
import { deployment, network, settings } from "../config";
import { duration, money, pct, rupees } from "../lib/format";
import { useRupeeRate, useScheme } from "../lib/hooks";
import type { SchemeData } from "../lib/hooks";

type Lang = "en" | "hi";

interface Facts {
  amount: string;
  rs: string;
  period: string;
  grace: string;
  count: number;
  fee: string;
  qie: number;
  swap: number;
  exchanges: string;
}

/** Durations in Hindi for whole days; anything shorter falls back to the English form. */
const hiDuration = (seconds: number) => (seconds % 86400 === 0 ? `${seconds / 86400} दिन` : duration(seconds));

const copy = {
  en: {
    title: "Join a Tola gold plan",
    lede: "Save a few cents a month in gold on QIE Mainnet, from your own wallet. The first time takes about 10 minutes.",
    beforeTitle: "Before you start",
    before: (f: Facts) => [
      "This is a demo shop run by the Tola team, not a real jeweller. No jewellery is delivered.",
      `Each instalment is ${f.amount}${f.rs ? ` (about ${f.rs})` : ""}, paid every ${f.period}, ${f.count} times. The money is real but tiny.`,
      `Your money stays locked in the contract. You can leave at any time for a ${f.fee} fee. At the end, once the delivery window has passed, you take your gold's value back in cash.`,
      "Tola is a student's hackathon project. The contracts have tests but no outside audit.",
    ],
    needTitle: "What you need",
    need: (f: Facts) => [
      "A laptop or computer with Chrome. Phone wallets may work through their built-in browser, but we have not tested them.",
      `About ${f.qie} QIE, for the instalments and network fees.`,
    ],
    stepsTitle: "Six steps",
    steps: (f: Facts) => [
      { title: "Install QIE Wallet", body: "Add the QIE Wallet extension to Chrome and create a wallet. Write the recovery phrase on paper and keep it safe. Nobody from Tola will ever ask for it.", link: "wallet" as const },
      { title: `Get ${f.qie} QIE`, body: `Ask the person who shared this page to send you some, or buy QIE on ${f.exchanges} and withdraw it to your wallet. Choose QIE Mainnet, chain 1990; coins sent on another network can be lost.` },
      { title: "Open the plan and connect", body: "Press Connect wallet, then approve in QIE Wallet.", link: "plan" as const },
      { title: "Swap QIE for digital dollars", body: `In the box "Swap QIE on QIEDEX", type ${f.swap} and press Swap. Keep the rest for network fees. QUSDC is a digital dollar on QIE.` },
      { title: "Join", body: `Press "Join: pay ${f.amount}" and approve twice: once to allow the payment, once to make it.` },
      { title: "Come back each month", body: `A new instalment opens every ${f.period} and stays open for ${f.grace}. Your passbook shows the date, and has a button to add reminders to your calendar.` },
    ],
    walletButton: "QIE Wallet for Chrome",
    planButton: "Open the plan",
    safety: "Tola will never ask for your recovery phrase or private key. Anyone who does is not us.",
    shareTitle: "Share with friends",
    shareBody: "Scan the code or send the link. Every wallet that joins shows up in the live count on the home page.",
    whatsapp: "Share on WhatsApp",
    copyLink: "Copy link",
    copied: "Copied",
    card: "Download card image",
    shareText: (url: string) => `Try Tola: save a few cents a month in gold on QIE, from your own wallet. Guide: ${url}`,
    reading: "Reading the plan from the chain…",
    closed: "This plan is not taking new customers right now, so the guide is paused.",
    cardTagline: "Gold savings your jeweller can't run away with",
    cardSteps: (qie: number) => ["Install QIE Wallet in Chrome", `Get about ${qie} QIE`, "Open the link, connect, join"],
  },
  hi: {
    title: "Tola गोल्ड प्लान से जुड़ें",
    lede: "अपने वॉलेट से, QIE Mainnet पर हर महीने कुछ सेंट सोने में बचाएँ। पहली बार लगभग 10 मिनट लगते हैं।",
    beforeTitle: "शुरू करने से पहले",
    before: (f: Facts) => [
      "यह Tola टीम की डेमो दुकान है, असली ज्वैलर नहीं। कोई गहना नहीं मिलेगा।",
      `हर किस्त ${f.amount}${f.rs ? ` (लगभग ${f.rs})` : ""} की है, हर ${f.period} में, कुल ${f.count} बार। पैसा असली है, पर बहुत कम।`,
      `आपका पैसा कॉन्ट्रैक्ट में बंद रहता है। आप कभी भी ${f.fee} फ़ीस देकर निकल सकते हैं। अंत में, डिलीवरी का समय बीतने के बाद, आप अपने सोने की कीमत नकद वापस लेते हैं।`,
      "Tola एक छात्र का हैकाथॉन प्रोजेक्ट है। कॉन्ट्रैक्ट टेस्ट किए गए हैं, पर किसी बाहरी ऑडिट से नहीं गुज़रे।",
    ],
    needTitle: "आपको क्या चाहिए",
    need: (f: Facts) => [
      "Chrome वाला लैपटॉप या कंप्यूटर। फ़ोन वॉलेट अपने अंदर के ब्राउज़र से चल सकते हैं, पर हमने उन्हें टेस्ट नहीं किया है।",
      `लगभग ${f.qie} QIE, किस्तों और नेटवर्क फ़ीस के लिए।`,
    ],
    stepsTitle: "छह कदम",
    steps: (f: Facts) => [
      { title: "QIE Wallet इंस्टॉल करें", body: "Chrome में QIE Wallet एक्सटेंशन जोड़ें और वॉलेट बनाएँ। रिकवरी फ़्रेज़ कागज़ पर लिखकर सुरक्षित रखें। Tola से कोई भी इसे कभी नहीं माँगेगा।", link: "wallet" as const },
      { title: `${f.qie} QIE लें`, body: `जिसने यह पेज भेजा है उससे माँगें, या ${f.exchanges} पर QIE खरीदकर अपने वॉलेट में निकालें। QIE Mainnet, chain 1990 चुनें; किसी और नेटवर्क पर भेजे सिक्के खो सकते हैं।` },
      { title: "प्लान खोलें और कनेक्ट करें", body: "Connect wallet दबाएँ, फिर QIE Wallet में मंज़ूरी दें।", link: "plan" as const },
      { title: "QIE को डिजिटल डॉलर में बदलें", body: `"Swap QIE on QIEDEX" वाले बॉक्स में ${f.swap} लिखें और Swap दबाएँ। बाकी QIE नेटवर्क फ़ीस के लिए रखें। QUSDC, QIE पर एक डिजिटल डॉलर है।` },
      { title: "जुड़ें", body: `"Join: pay ${f.amount}" दबाएँ और दो बार मंज़ूरी दें: एक बार भुगतान की अनुमति के लिए, एक बार भुगतान के लिए।` },
      { title: "हर महीने वापस आएँ", body: `नई किस्त हर ${f.period} में खुलती है और ${f.grace} तक खुली रहती है। आपकी पासबुक में तारीख दिखती है, और वहीं से कैलेंडर में रिमाइंडर जोड़ सकते हैं।` },
    ],
    walletButton: "Chrome के लिए QIE Wallet",
    planButton: "प्लान खोलें",
    safety: "Tola आपसे कभी रिकवरी फ़्रेज़ या प्राइवेट की नहीं माँगेगा। जो माँगे, वह हम नहीं हैं।",
    shareTitle: "दोस्तों के साथ शेयर करें",
    shareBody: "कोड स्कैन करें या लिंक भेजें। जुड़ने वाला हर वॉलेट होम पेज की लाइव गिनती में दिखता है।",
    whatsapp: "WhatsApp पर शेयर करें",
    copyLink: "लिंक कॉपी करें",
    copied: "कॉपी हो गया",
    card: "कार्ड इमेज डाउनलोड करें",
    shareText: (url: string) => `Tola आज़माएँ: अपने वॉलेट से, QIE पर हर महीने कुछ सेंट सोने में बचाएँ। गाइड: ${url}`,
    reading: "चेन से प्लान पढ़ा जा रहा है…",
    closed: "यह प्लान अभी नए ग्राहक नहीं ले रहा, इसलिए गाइड रुकी हुई है।",
    cardTagline: "ऐसी सोने की बचत, जिसे ज्वैलर लेकर भाग नहीं सकता",
    cardSteps: (qie: number) => ["Chrome में QIE Wallet इंस्टॉल करें", `लगभग ${qie} QIE लें`, "लिंक खोलें, कनेक्ट करें, जुड़ें"],
  },
};

const storageKey = "tola-join-lang";

function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      return localStorage.getItem(storageKey) === "hi" ? "hi" : "en";
    } catch {
      return "en";
    }
  });
  const choose = (l: Lang) => {
    setLang(l);
    try {
      localStorage.setItem(storageKey, l);
    } catch {
      // A private window may refuse storage; the choice still holds for this visit.
    }
  };
  return [lang, choose];
}

function useQr(text: string) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    // The code takes the page's own ink colour, so it matches the design tokens.
    const ink = getComputedStyle(document.documentElement).getPropertyValue("--text").trim();
    void QRCode.toString(text, { type: "svg", margin: 1, color: { dark: ink, light: "#00000000" } }).then(setSvg);
  }, [text]);
  return svg;
}

function facts(scheme: SchemeData, lang: Lang, rate: number | null): Facts {
  const { terms, decimals } = scheme;
  const usd = Number(terms.instalment) / 10 ** decimals;
  const d = lang === "hi" ? hiDuration : duration;
  return {
    amount: money(terms.instalment, decimals),
    rs: rupees(usd, rate) ?? "",
    period: d(terms.period),
    grace: d(terms.gracePeriod),
    count: terms.instalmentCount,
    fee: pct(terms.exitFeeBps),
    qie: settings.joinKit.qieToGet,
    swap: settings.joinKit.qieToSwap,
    exchanges: settings.joinKit.exchanges.join(", "),
  };
}

export function Join() {
  const [lang, setLang] = useLang();
  const plan = deployment?.joinPlan ?? null;
  const { data: scheme } = useScheme(plan ?? "");
  const rate = useRupeeRate();
  const [copied, setCopied] = useState(false);
  const joinUrl = `${window.location.origin}${window.location.pathname}#/join`;
  const qr = useQr(joinUrl);
  const t = copy[lang];

  if (!plan) return <div className="scheme-head"><p className="muted">Tola is not deployed on this network yet.</p></div>;

  const f = scheme ? facts(scheme, lang, rate) : null;
  const open = scheme ? !scheme.defaulted && scheme.flaggedAt === 0 : true;
  const planHref = `#/scheme/${plan}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), settings.txDismissMs);
    } catch {
      window.prompt(t.copyLink, joinUrl);
    }
  };

  return (
    <div className="join" lang={lang}>
      <div className="scheme-head">
        <div className="lang-toggle" role="group" aria-label="Language">
          <button className={lang === "en" ? "active" : ""} aria-pressed={lang === "en"} onClick={() => setLang("en")}>English</button>
          <button className={lang === "hi" ? "active" : ""} aria-pressed={lang === "hi"} onClick={() => setLang("hi")} lang="hi">हिंदी</button>
        </div>
        <h1>{t.title}</h1>
        <p className="hero-lede">{t.lede}</p>
      </div>

      {!f ? (
        <p className="muted">{t.reading}</p>
      ) : (
        <>
          {!open && <div className="notice notice-warn" role="alert">{t.closed}</div>}

          <section className="split">
            <h2>{t.beforeTitle}</h2>
            <ul className="join-list">{t.before(f).map((line) => <li key={line}>{line}</li>)}</ul>
          </section>

          <section className="split">
            <h2>{t.needTitle}</h2>
            <ul className="join-list">{t.need(f).map((line) => <li key={line}>{line}</li>)}</ul>
          </section>

          <section className="split">
            <h2>{t.stepsTitle}</h2>
            <div>
              <ol className="promises">
                {t.steps(f).map((step) => (
                  <li key={step.title}>
                    <div>
                      <strong>{step.title}{lang === "hi" ? "" : "."}</strong> {step.body}
                      {step.link === "wallet" && (
                        <div className="btn-row" style={{ marginTop: 12 }}>
                          <a className="btn btn-quiet" href={settings.joinKit.walletExtensionUrl} target="_blank" rel="noreferrer">
                            {t.walletButton} <ExternalLink size={14} aria-hidden />
                          </a>
                        </div>
                      )}
                      {step.link === "plan" && (
                        <div className="btn-row" style={{ marginTop: 12 }}>
                          <a className="btn" href={planHref} aria-disabled={!open}>{t.planButton}: {scheme?.shopName}</a>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              <p className="small" style={{ marginTop: 16 }}><ShieldCheck size={15} className="icon-inline" aria-hidden /> {t.safety}</p>
            </div>
          </section>
        </>
      )}

      <section className="split" id="share">
        <h2>{t.shareTitle}</h2>
        <div className="share-grid">
          <div className="join-card" aria-label="Tola join card">
            <div className="join-card-head">
              <span className="wordmark">Tola</span>
              <span className="xs muted">{network.name}</span>
            </div>
            <p className="join-card-tagline">{copy.en.cardTagline}</p>
            <p className="join-card-tagline" lang="hi">{copy.hi.cardTagline}</p>
            <div className="join-qr" role="img" aria-label={`QR code for ${joinUrl}`} dangerouslySetInnerHTML={qr ? { __html: qr } : undefined} style={{ width: settings.joinKit.qrSizePx, height: settings.joinKit.qrSizePx }} />
            <ol className="join-card-steps">
              {copy.en.cardSteps(settings.joinKit.qieToGet).map((s, i) => (
                <li key={s}><span>{s}</span><span lang="hi" className="muted">{copy.hi.cardSteps(settings.joinKit.qieToGet)[i]}</span></li>
              ))}
            </ol>
            <p className="xs mono join-card-url">{joinUrl.replace(/^https?:\/\//, "")}</p>
          </div>
          <div className="stack">
            <p>{t.shareBody}</p>
            <div className="btn-row">
              <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(t.shareText(joinUrl))}`} target="_blank" rel="noreferrer">
                <MessageCircle size={16} aria-hidden /> {t.whatsapp}
              </a>
              <button className="btn btn-quiet" onClick={() => void copyLink()}>
                {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />} {copied ? t.copied : t.copyLink}
              </button>
            </div>
            <a className="small" href={settings.joinKit.cardImage} download>
              <Download size={14} className="icon-inline" aria-hidden /> {t.card}
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
