import { AlbumOfTheDay } from "../components/AlbumOfTheDay";
import { AlbumsOfWeek } from "../components/AlbumsOfWeek";
import { BecauseYouLiked } from "../components/BecauseYouLiked";
import { DailyMix } from "../components/DailyMix";
import { Promo } from "../components/Promo";
import { Statistics } from "../components/Statistics";
import { useT } from "../i18n";
import { useDocumentTitle, useShell } from "./shell";

/** The dashboard from the mockup (+ a personal "Because you liked" row when there is enough data). */
export function HomePage() {
  const t = useT();
  const { query, showPromo, closePromo } = useShell();
  useDocumentTitle("");

  return (
    <>
      <h1 className="sr-only">{t("home.title")}</h1>
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
      <BecauseYouLiked />
    </>
  );
}
