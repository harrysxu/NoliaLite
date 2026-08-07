// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DiagramViewer, _testing } from "./DiagramViewer";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DiagramViewer", () => {
  it("zooms from the Nolia-compatible initial scale and resets", () => {
    render(
      <DiagramViewer
        content={{ svg: '<svg viewBox="0 0 100 80"></svg>', markdown: "```mermaid\ngraph TD\n```", initialScale: 1.25 }}
        onClose={() => undefined}
      />
    );
    const canvas = document.querySelector<HTMLElement>(".diagram-viewer-canvas");
    const diagram = document.querySelector<HTMLElement>(".diagram-viewer-diagram");
    expect(screen.getByText("125%")).toBeTruthy();
    expect(canvas?.style.width).toBe("125%");
    expect(diagram?.style.aspectRatio).toBe("1.25");
    fireEvent.click(screen.getByRole("button", { name: "放大图表" }));
    expect(screen.getByText("150%")).toBeTruthy();
    expect(canvas?.style.width).toBe("150%");
    expect(diagram?.style.aspectRatio).toBe("1.25");
    fireEvent.click(screen.getByRole("button", { name: "恢复图表比例" }));
    expect(screen.getByText("100%")).toBeTruthy();
    expect(canvas?.style.width).toBe("100%");
  });

  it("uses the SVG viewBox as the stable two-dimensional zoom ratio", () => {
    expect(_testing.svgAspectRatio('<svg width="100%" height="500" viewBox="0 0 1200 800"></svg>')).toBe(1.5);
    expect(_testing.svgAspectRatio('<svg width="640" height="320"></svg>')).toBe(2);
    expect(_testing.svgAspectRatio("not svg")).toBeCloseTo(16 / 9);
  });

  it("returns to source editing with F2", () => {
    const onClose = vi.fn();
    const onEdit = vi.fn();
    render(
      <DiagramViewer
        content={{ svg: "<svg></svg>", markdown: "", onEdit }}
        onClose={onClose}
      />
    );
    fireEvent.keyDown(document, { key: "F2" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it("exports a PNG with a safe file name and releases object URLs", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:diagram-svg")
      .mockReturnValueOnce("blob:diagram-png");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob(["png"], { type: "image/png" }));
    });
    let downloadedName = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloadedName = this.download;
    });
    class LoadedImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", LoadedImage);

    render(
      <DiagramViewer
        content={{ svg: '<svg viewBox="0 0 100 80"></svg>', markdown: "", name: "Flow:Diagram.svg" }}
        onClose={() => undefined}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "下载 PNG 图片" }));

    await waitFor(() => expect(downloadedName).toBe("Flow-Diagram.png"));
    expect(drawImage).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:diagram-png"));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:diagram-svg");
  });
});
