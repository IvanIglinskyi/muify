import { AlbumOfTheDay } from "../components/AlbumOfTheDay";
import { AlbumsOfWeek } from "../components/AlbumsOfWeek";
import { DailyMix } from "../components/DailyMix";
import { Promo } from "../components/Promo";
import { Statistics } from "../components/Statistics";
import { useDocumentTitle, useShell } from "./shell";

/** The dashboard from the mockup. */
export function HomePage() {
  const { query, showPromo, closePromo } = useShell();
  useDocumentTitle("");

  return (
    <>
      <h1 className="sr-only">Home</h1>
      <div className="row row-top">
        <AlbumOfTheDay />
        <AlbumsOfWeek />
      </div>
      <div className="row row-bottom">
        <DailyMix query={query} />
        <div className="side-col">
          {showPromo && <Promo onClose={closePromo} />}
          <Statistics />
        </div>
      </div>
    </>
  );
}
