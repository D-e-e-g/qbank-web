import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { Markable } from "./highlight/Markable";
import type { LoadedQuestion, QuestionImage, QuestionTable } from "./model";

/** The table and images that go with the stem. Every screen that shows a stem draws these under it. */
export function StemExhibits({ loaded }: { loaded: LoadedQuestion }) {
  const images = loaded.images.filter((image) => image.at === "stem");
  if (!loaded.table && images.length === 0) return null;
  return (
    <>
      {loaded.table ? <ExhibitTable table={loaded.table} /> : null}
      <ExhibitImages images={images} />
    </>
  );
}

/** The images that explain the answer. They show only once the rationale does. */
export function RationaleImages({ loaded }: { loaded: LoadedQuestion }) {
  return <ExhibitImages images={loaded.images.filter((image) => image.at === "rationale")} />;
}

function ExhibitTable({ table }: { table: QuestionTable }) {
  return (
    <figure className="exhibit">
      {table.caption ? (
        <figcaption className="exhibit-caption">
          <Markable piece="caption" text={table.caption} />
        </figcaption>
      ) : null}
      {/* A wide table scrolls sideways inside its box instead of squeezing on a phone. */}
      <div className="exhibit-table-scroll" role="region" aria-label={table.caption ?? "Table"} tabIndex={0}>
        <table className="exhibit-table">
          {table.head.length > 0 ? (
            <thead>
              <tr>
                {table.head.map((cell, index) => (
                  <th key={index} scope="col">
                    <Markable piece={`head:${String(index)}`} text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, index) => (
                  <td key={index}>
                    <Markable piece={`cell:${String(rowIndex)}:${String(index)}`} text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function ExhibitImages({ images }: { images: QuestionImage[] }) {
  const [zoomed, setZoomed] = useState<QuestionImage | null>(null);
  if (images.length === 0) return null;
  return (
    <>
      {images.map((image, index) => (
        <figure key={index} className="exhibit">
          <button
            type="button"
            className="exhibit-image-button"
            aria-label={`Enlarge image: ${image.alt}`}
            onClick={() => {
              setZoomed(image);
            }}
          >
            <img className="exhibit-image" src={image.url} alt={image.alt} decoding="async" />
          </button>
          {image.caption ? <figcaption className="exhibit-caption">{image.caption}</figcaption> : null}
        </figure>
      ))}
      {zoomed ? (
        <ImageViewer
          image={zoomed}
          onClose={() => {
            setZoomed(null);
          }}
        />
      ) : null}
    </>
  );
}

/** The image at full screen. Pinch to zoom further; tap outside it, Close, or Escape to go back. */
function ImageViewer({ image, onClose }: { image: QuestionImage; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Width over height, once the image loads, so it can grow to fill the screen with its white backing.
  const [ratio, setRatio] = useState<number | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    // Focus the dialog rather than Close, so a tap does not light up a focus ring.
    dialog.focus();
    return () => {
      dialog.close();
    };
  }, []);

  // A tap on the empty space around the image goes back, like the backdrop of a sheet.
  const closeOnEmptySpace = (event: MouseEvent<HTMLElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="exhibit-viewer"
      aria-label={image.alt}
      tabIndex={-1}
      onClose={onClose}
      onClick={closeOnEmptySpace}
    >
      <div className="exhibit-viewer-bar">
        <Button variant="plain" className="exhibit-viewer-close" onClick={onClose}>
          <Icon name="x" size={20} />
          Close
        </Button>
      </div>
      <div className="exhibit-viewer-body" onClick={closeOnEmptySpace}>
        <div className="exhibit-viewer-frame" onClick={closeOnEmptySpace}>
          <img
            className="exhibit-viewer-image"
            src={image.url}
            alt={image.alt}
            style={ratio ? ({ "--ratio": String(ratio) } as CSSProperties) : undefined}
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (naturalWidth > 0 && naturalHeight > 0) setRatio(naturalWidth / naturalHeight);
            }}
          />
        </div>
        {image.caption ? <p className="exhibit-viewer-caption">{image.caption}</p> : null}
      </div>
    </dialog>
  );
}
