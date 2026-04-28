// Type declaration for katex/contrib/auto-render (not included in the katex package types).
declare module 'katex/contrib/auto-render' {
  interface DelimiterSpec {
    left: string;
    right: string;
    display: boolean;
  }

  interface RenderMathInElementOptions {
    delimiters?: DelimiterSpec[];
    ignoredTags?: string[];
    ignoredClasses?: string[];
    errorCallback?: (msg: string, err: Error) => void;
    preProcess?: (math: string) => string;
    displayMode?: boolean;
    throwOnError?: boolean;
    errorColor?: string;
    macros?: Record<string, string>;
  }

  function renderMathInElement(elem: HTMLElement, options?: RenderMathInElementOptions): void;
  export default renderMathInElement;
}
