/** Shipment steps for an order (Phase 10): Track Order and My Orders.
 *  The shipping is simulated, and says so. */
import { CheckCircle2, Circle, Truck } from "lucide-react";
import { niceDate, type Shipment } from "../../api/shop";
import { cx } from "../ui";

export function ShipmentProgress({ shipment }: { shipment: Shipment }) {
  const current = shipment.steps.filter((s) => s.done).length - 1;
  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col" aria-label="Shipment progress">
        {shipment.steps.map((s, i) => (
          <li key={s.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              {s.done
                ? <CheckCircle2 size={20} className="text-good shrink-0" aria-hidden="true" />
                : <Circle size={20} className="text-faint shrink-0" aria-hidden="true" />}
              {i < shipment.steps.length - 1 && (
                <span className={cx("w-px flex-1 min-h-4 my-1", s.done && shipment.steps[i + 1].done ? "bg-good" : "bg-line")} />
              )}
            </div>
            <div className="pb-3 min-w-0">
              <p className={cx("text-sm leading-5", i === current ? "font-semibold" : s.done ? "text-ink" : "text-muted")}>
                <span className="sr-only">{s.done ? "Done: " : "Not yet: "}</span>{s.label}
              </p>
              {s.done && s.at && <p className="text-xs text-muted">{niceDate(s.at)}</p>}
            </div>
          </li>
        ))}
      </ol>
      <div className="rounded-2xl bg-panel p-4 text-sm flex flex-col gap-1">
        <p className="flex items-center gap-2 font-medium"><Truck size={15} />
          {shipment.tracking_number ? <>Tracking ID <span className="tabular-nums">{shipment.tracking_number}</span></> : "Tracking ID: assigned when your order ships"}
        </p>
        {shipment.estimated_delivery && <p className="text-muted">Estimated delivery {niceDate(shipment.estimated_delivery)}</p>}
        {shipment.simulated && <p className="text-xs text-muted">Demo store: shipping is simulated, not a real carrier.</p>}
      </div>
    </div>
  );
}
