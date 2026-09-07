export const PROTOTYPE_PREVIEW_FONT_IDS = [
  'ibm-plex-serif',
  'cal-sans-ui',
  'inter',
  'inter-tight',
  'geist-sans',
  'geist-mono',
  'libre-baskerville',
  'fira-code',
  'newsreader',
  'manrope',
  'bodoni-moda',
  'roboto-mono',
  'barlow-condensed',
  'dm-sans',
  'fragment-mono',
  'hedvig-letters-serif',
] as const

export type PrototypePreviewFontId = typeof PROTOTYPE_PREVIEW_FONT_IDS[number]

type PrototypePreviewFont = {
  family: string
  id: PrototypePreviewFontId
  matcher: RegExp
  sources: readonly {
    file: string
    format: 'woff2' | 'woff2-variations'
    style?: 'italic' | 'normal'
    weight: string
  }[]
}

const PROTOTYPE_PREVIEW_FONTS: readonly PrototypePreviewFont[] = [
  {
    family: 'IBM Plex Serif',
    id: 'ibm-plex-serif',
    matcher: /(?:^|[\s,"'])IBM Plex Serif(?=$|[\s,"')])/i,
    sources: [
      { file: 'ibm-plex-serif-latin-400-normal.woff2', format: 'woff2', weight: '400' },
      { file: 'ibm-plex-serif-latin-500-normal.woff2', format: 'woff2', weight: '500' },
    ],
  },
  {
    family: 'Cal Sans UI',
    id: 'cal-sans-ui',
    matcher: /(?:^|[\s,"'])Cal Sans UI(?=$|[\s,"')])/i,
    sources: [{
      file: 'cal-sans-ui-latin-wght-normal.woff2',
      format: 'woff2-variations',
      weight: '300 700',
    }],
  },
  {
    family: 'Libre Baskerville',
    id: 'libre-baskerville',
    matcher: /(?:^|[\s,"'])Libre Baskerville(?=$|[\s,"')])/i,
    sources: [{
      file: 'libre-baskerville-latin-wght-normal.woff2',
      format: 'woff2-variations',
      weight: '400 700',
    }],
  },
  {
    family: 'Inter',
    id: 'inter',
    matcher: /(?:^|[\s,"'])Inter(?=$|[\s,"')])/i,
    sources: [{ file: 'inter-latin-wght-normal.woff2', format: 'woff2-variations', weight: '100 900' }],
  },
  {
    family: 'Inter Tight',
    id: 'inter-tight',
    matcher: /(?:^|[\s,"'])Inter Tight(?=$|[\s,"')])/i,
    sources: [{ file: 'inter-tight-latin-wght-normal.woff2', format: 'woff2-variations', weight: '100 900' }],
  },
  {
    family: 'Geist Sans',
    id: 'geist-sans',
    matcher: /(?:^|[\s,"'])Geist Sans(?=$|[\s,"')])/i,
    sources: [{ file: 'geist-latin-wght-normal.woff2', format: 'woff2-variations', weight: '100 900' }],
  },
  {
    family: 'Geist Mono',
    id: 'geist-mono',
    matcher: /(?:^|[\s,"'])Geist Mono(?=$|[\s,"')])/i,
    sources: [{ file: 'geist-mono-latin-wght-normal.woff2', format: 'woff2-variations', weight: '100 900' }],
  },
  {
    family: 'Fira Code',
    id: 'fira-code',
    matcher: /(?:^|[\s,"'])Fira Code(?=$|[\s,"')])/i,
    sources: [{
      file: 'fira-code-latin-wght-normal.woff2',
      format: 'woff2-variations',
      weight: '300 700',
    }],
  },
  {
    family: 'Newsreader',
    id: 'newsreader',
    matcher: /(?:^|[\s,"'])Newsreader(?=$|[\s,"')])/i,
    sources: [
      {
        file: 'newsreader-latin-wght-normal.woff2',
        format: 'woff2-variations',
        style: 'normal',
        weight: '200 800',
      },
      {
        file: 'newsreader-latin-wght-italic.woff2',
        format: 'woff2-variations',
        style: 'italic',
        weight: '200 800',
      },
    ],
  },
  {
    family: 'Manrope',
    id: 'manrope',
    matcher: /(?:^|[\s,"'])Manrope(?=$|[\s,"')])/i,
    sources: [{
      file: 'manrope-latin-wght-normal.woff2',
      format: 'woff2-variations',
      weight: '200 800',
    }],
  },
  {
    family: 'Bodoni Moda Variable',
    id: 'bodoni-moda',
    matcher: /(?:^|[\s,"'])Bodoni Moda Variable(?=$|[\s,"')])/i,
    sources: [
      {
        file: 'bodoni-moda-latin-standard-normal.woff2',
        format: 'woff2-variations',
        style: 'normal',
        weight: '400 900',
      },
      {
        file: 'bodoni-moda-latin-standard-italic.woff2',
        format: 'woff2-variations',
        style: 'italic',
        weight: '400 900',
      },
    ],
  },
  {
    family: 'Roboto Mono Variable',
    id: 'roboto-mono',
    matcher: /(?:^|[\s,"'])Roboto Mono Variable(?=$|[\s,"')])/i,
    sources: [{
      file: 'roboto-mono-latin-wght-normal.woff2',
      format: 'woff2-variations',
      weight: '100 700',
    }],
  },
  {
    family: 'Barlow Condensed',
    id: 'barlow-condensed',
    matcher: /(?:^|[\s,"'])Barlow Condensed(?=$|[\s,"')])/i,
    sources: [{
      file: 'barlow-condensed-latin-900-normal.woff2',
      format: 'woff2',
      weight: '900',
    }],
  },
  {
    family: 'DM Sans Variable',
    id: 'dm-sans',
    matcher: /(?:^|[\s,"'])DM Sans Variable(?=$|[\s,"')])/i,
    sources: [
      {
        file: 'dm-sans-latin-wght-normal.woff2',
        format: 'woff2-variations',
        style: 'normal',
        weight: '100 1000',
      },
      {
        file: 'dm-sans-latin-wght-italic.woff2',
        format: 'woff2-variations',
        style: 'italic',
        weight: '100 1000',
      },
    ],
  },
  {
    family: 'Fragment Mono',
    id: 'fragment-mono',
    matcher: /(?:^|[\s,"'])Fragment Mono(?=$|[\s,"')])/i,
    sources: [{
      file: 'fragment-mono-latin-400-normal.woff2',
      format: 'woff2',
      weight: '400',
    }],
  },
  {
    family: 'Hedvig Letters Serif',
    id: 'hedvig-letters-serif',
    matcher: /(?:^|[\s,"'])Hedvig Letters Serif(?=$|[\s,"')])/i,
    sources: [{
      file: 'hedvig-letters-serif-latin-400-normal.woff2',
      format: 'woff2',
      weight: '400',
    }],
  },
]

export function detectPrototypePreviewFonts(source: string): PrototypePreviewFontId[] {
  return PROTOTYPE_PREVIEW_FONTS.flatMap((font) => (
    font.matcher.test(source) ? [font.id] : []
  ))
}

export function createPrototypePreviewFontCss(source: string) {
  const detected = new Set(detectPrototypePreviewFonts(source))
  return PROTOTYPE_PREVIEW_FONTS
    .filter((font) => detected.has(font.id))
    .flatMap((font) => font.sources.map((source) => [
        '@font-face {',
        `  font-family: "${font.family}";`,
        '  font-display: swap;',
        `  font-style: ${source.style ?? 'normal'};`,
        `  font-weight: ${source.weight};`,
        `  src: url("/prototype-fonts/${source.file}") format("${source.format}");`,
        '}',
      ].join('\n')))
    .join('\n\n')
}
