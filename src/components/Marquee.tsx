/** Scrolling ticker band. The track is duplicated so the loop is seamless. */
export function Marquee({
  items,
  tone = "lime",
}: {
  items: string[];
  tone?: "lime" | "violet";
}) {
  const doubled = [...items, ...items];
  const skin =
    tone === "lime"
      ? "bg-lime text-bg border-lime"
      : "bg-accent text-bg border-accent";

  return (
    <div className={`overflow-hidden rounded-2xl border ${skin}`}>
      <div className="marquee-track py-3">
        {doubled.map((item, i) => (
          <span key={i} className="flex shrink-0 items-center">
            <span className="display px-6 text-lg sm:text-xl">{item}</span>
            <span aria-hidden className="text-xs opacity-60">
              ◆
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
