/**
 * The slice of the Mermaid API this facade uses. Deliberately structural and
 * minimal rather than a dependency on Mermaid's own types: the library is
 * BRING-YOUR-OWN and is never installed here, so there is no @types package to
 * import and pinning to one would defeat the point of the quarantine. Anything
 * satisfying this shape works, which is what makes swapping the engine a
 * copy-this-file exercise.
 */
interface MermaidLib {
    initialize(config: Record<string, unknown>): void;
    render(id: string, source: string): Promise<{
        svg: string;
    }> | string;
}
declare global {
    interface Window {
        /** Set by the host page if it loaded Mermaid itself; option 1 in loadLib(). */
        mermaid?: MermaidLib;
    }
}
export {};
