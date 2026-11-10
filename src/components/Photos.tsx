// A horizontal strip of a place's Google photos, like Google Maps search results.
// Each photo loads only when it scrolls into view, and shows the author credit
// Google requires.
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, UtensilsCrossed } from "lucide-react";
import type { PlacePhoto } from "../lib/lunch.ts";

export function PhotoStrip({ photos, label, size = "sm" }: { photos?: PlacePhoto[]; label: string; size?: "sm" | "lg" }) {
  const strip = useRef<HTMLDivElement>(null);
  if (!photos?.length) {
    return <div className={`ph-none ${size}`}><UtensilsCrossed size={size === "lg" ? 30 : 20} aria-hidden="true" /><span>No photos on Google</span></div>;
  }
  const go = (dir: number) => {
    const el = strip.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };
  return (
    <div className={`ph-wrap ${size}`}>
      <div className="ph-strip" ref={strip} role="group" aria-label={`Photos of ${label}`}>
        {photos.map((p, i) => <Photo key={p.uri} p={p} alt={`${label}, photo ${i + 1} of ${photos.length}`} />)}
      </div>
      {photos.length > 1 && (
        <>
          <button className="ph-nav prev" onClick={(e) => { e.stopPropagation(); go(-1); }} aria-label="Previous photos"><ChevronLeft size={18} aria-hidden="true" /></button>
          <button className="ph-nav next" onClick={(e) => { e.stopPropagation(); go(1); }} aria-label="More photos"><ChevronRight size={18} aria-hidden="true" /></button>
        </>
      )}
    </div>
  );
}

function Photo({ p, alt }: { p: PlacePhoto; alt: string }) {
  const ref = useRef<HTMLElement>(null);
  const [show, setShow] = useState(false);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) { setShow(true); return; }
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { setShow(true); io.disconnect(); }
    }, { rootMargin: "0px 60px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <figure ref={ref} className="ph">
      {show && !broken ? <img src={p.uri} alt={alt} onError={() => setBroken(true)} draggable={false} /> : <span className="ph-blank" aria-hidden="true" />}
      {p.author && (
        <figcaption>
          {p.authorUri ? <a href={p.authorUri} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{p.author}</a> : p.author}
        </figcaption>
      )}
    </figure>
  );
}
