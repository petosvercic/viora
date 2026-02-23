import type { LevelProfile, RawProfile } from "./decisionModel";

type ProfileInput = {
  raw: RawProfile;
  level: LevelProfile;
};

type FreeReport = {
  signature: string;
  riskSpot: string;
  intervention: string;
};

const speedText = {
  high: "Rozhoduješ sa rýchlo a prirodzene preberáš iniciatívu.",
  medium: "Tempo rozhodovania máš vyvážené a vieš ho meniť podľa situácie.",
  low: "Do rozhodnutia vstupuješ opatrnejšie a preferuješ viac času na overenie.",
};

const processingText = {
  high: "Opieraš sa o štruktúru, porovnanie variantov a jasné argumenty.",
  medium: "Kombinuješ analytiku s intuitívnym odhadom podľa kontextu.",
  low: "Často pracuješ s celkovým dojmom a rýchlym interpretačným rámcom.",
};

const riskText = {
  high: "Pri neistote vieš ísť do rozhodnutia aj bez kompletnej istoty.",
  medium: "Riziko prijímaš selektívne, keď vidíš aspoň základnú kontrolu dopadov.",
  low: "Preferuješ stabilnejšie varianty a nižšiu mieru nepredvídateľnosti.",
};

const pressureText = {
  high: "Pod tlakom si funkčný/á a udržíš smer aj pri zmene podmienok.",
  medium: "Výkon pod tlakom držíš, ale vyžaduje to vedomé riadenie pozornosti.",
  low: "V záťaži máš tendenciu spomaľovať a vracať sa k rozhodnutiu opakovane.",
};

const controlText = {
  high: "Silno potrebuješ jasný rámec, pravidlá a predvídateľný postup.",
  medium: "Kontrolu využívaš pragmaticky: máš plán, ale vieš ho upraviť.",
  low: "Funguješ flexibilne a dobre toleruješ otvorené, menej definované prostredie.",
};

export function generateFreeReport(profile: ProfileInput): FreeReport {
  const { raw, level } = profile;

  const signature = [
    `${speedText[level.speed]} ${processingText[level.processing]}`,
    `${riskText[level.risk]} ${pressureText[level.pressure]}`,
    `${controlText[level.control]} V súčte to vytvára konzistentný rozhodovací štýl, ktorý je čitateľný naprieč rôznymi situáciami.`,
  ].join("\n\n");

  const riskCandidates = [
    { key: "speed", score: raw.speed, text: "Pri vyššom tempe môže vzniknúť slepé miesto v overení detailov. V praxi to znamená, že rozhodnutie je rýchle, ale nie vždy má dostatočne ošetrené sekundárne dopady." },
    { key: "processing", score: raw.processing, text: "Pri silnej analytike hrozí predĺžené porovnávanie variantov. Rizikom je, že sa znižuje rýchlosť exekúcie v okne, kde by stačilo rozhodnúť s dostupnými dátami." },
    { key: "risk", score: raw.risk, text: "V práci s neistotou môže byť kritické správne nastaviť hranicu prijateľného rizika. Bez tejto hranice môžeš buď zbytočne brzdiť, alebo naopak podceniť ochranné kroky." },
    { key: "pressure", score: raw.pressure, text: "Pod zaťažením sa najčastejšie láme kvalita pozornosti. Aj pri dobrom výkone môže prísť k zúženiu perspektívy a slabšiemu vyhodnoteniu alternatív." },
    { key: "control", score: raw.control, text: "Potreba kontroly je užitočná, no pri vyššej intenzite môže spomaľovať rozhodovanie v dynamickom prostredí. Kritické je rozlišovať, čo musí byť pod kontrolou a čo stačí monitorovať." },
  ];

  const topRisk = riskCandidates.sort((a, b) => b.score - a.score)[0];
  const riskSpot = [
    topRisk.text,
    "Odporúčanie je držať jeden krátky checkpoint pred finálnym rozhodnutím: čo viem, čo neviem a čo je minimálny bezpečný krok. Tento rámec znižuje chybovosť bez výrazného spomalenia.",
  ].join("\n\n");

  const intervention = [
    "Zaveď pravidlo 90 sekúnd pred dôležitým rozhodnutím: pomenuj cieľ, jedno hlavné riziko a prvý overiteľný krok. Tento mikro-postup vytvorí stabilný rozhodovací rytmus aj v neistote.",
    level.control === "high"
      ? "Keďže potreba kontroly je u teba výraznejšia, dopredu si urč, ktoré 2 premenné musíš mať pod kontrolou a zvyšok nechaj ako priebežné monitorovanie. Získaš rýchlosť bez straty kvality."
      : "Ak máš nižšiu potrebu kontroly, pridaj si k rozhodnutiu jeden pevný bod verifikácie po 24 hodinách. Udržíš flexibilitu, no zároveň zvýšiš presnosť ďalších rozhodnutí.",
    "Po týždni si spätne prejdi 3 rozhodnutia a vyhodnoť: čo fungovalo, čo bolo zbytočné a čo chceš zopakovať. Takto sa profil mení na praktický systém, nie iba jednorazový výstup.",
  ].join("\n\n");

  return { signature, riskSpot, intervention };
}
