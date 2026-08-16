declare module "underscore" {
  const underscore: unknown;
  export default underscore;
}

declare module "raphael" {
  const raphael: unknown;
  export default raphael;
}

declare module "@rokt33r/js-sequence-diagrams" {
  type SequenceDiagram = {
    drawSVG: (container: HTMLElement, options: { theme: "simple" }) => void;
  };

  const api: {
    parse: (source: string) => SequenceDiagram;
  };

  export default api;
}

declare module "@rokt33r/js-sequence-diagrams/dist/sequence-diagram-raphael.js" {
  const api: {
    parse: (source: string) => {
      drawSVG: (container: HTMLElement, options: { theme: "simple" }) => void;
    };
  };

  export default api;
}
