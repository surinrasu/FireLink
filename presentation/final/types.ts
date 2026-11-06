export type Language = "zh" | "en";
export type Bilingual = Record<Language, string>;
export type LocalizedText = string | Bilingual;
export type Items = [LocalizedText, LocalizedText][];

interface SlideBase {
  id: string;
  section: number;
  title: Bilingual;
  notes: string;
  time?: number;
  lead?: LocalizedText;
  source?: LocalizedText;
  callout?: LocalizedText;
}

export type TableSlide = SlideBase & {
  layout: "table" | "journey" | "blueprint";
  headers: LocalizedText[];
  rows: LocalizedText[][];
};

export type Slide = SlideBase & (
  | { layout: "cover"; subtitle: LocalizedText; image: string }
  | TableSlide
  | { layout: "screen" | "design"; image: string; imagePosition?: string; items: Items }
  | { layout: "flow"; lanes: { label: LocalizedText; nodes: LocalizedText[] }[]; branches: LocalizedText[] }
  | { layout: "phones"; phones: { image: string; title: LocalizedText; text: LocalizedText }[] }
  | { layout: "architecture"; layers: { title: LocalizedText; text: LocalizedText }[] }
  | { layout: "evidence"; metrics: { n: string; label: LocalizedText }[]; items: Items }
  | { layout: "statement" | "columns" | "scope" | "states" | "closing" | "qa" | "sources"; items: Items }
  | { layout: "brand-end" }
);

export interface Deck {
  title: Bilingual;
  authors: string;
  date: string;
  mainCount: number;
  sections: Bilingual[];
  slides: Slide[];
}
