const CMU_WA = "525590002092"; // 55 9000 2092 from flyer
const CONGRESS_2027 =
  "51° Congreso Internacional de Urología — Tijuana, BC — 11 al 15 de abril 2027";

type Props = {
  open: boolean;
  onClose: () => void;
  onHome: () => void;
};

function waLink(text: string) {
  return `https://wa.me/${CMU_WA}?text=${encodeURIComponent(text)}`;
}

export function RemindersPanel({ open, onClose, onHome }: Props) {
  if (!open) return null;

  const monthly =
    "Hola CMU, quiero recordatorios por WhatsApp de las sesiones mensuales / académicos del Colegio.";
  const congress =
    `Hola CMU, agéndame recordatorios del ${CONGRESS_2027}. Gracias.`;

  return (
    <div
      className="overlay-panel reminders-panel"
      role="dialog"
      aria-label="Recordatorios"
    >
      <div className="overlay-head">
        <div>
          <p className="overlay-kicker">WhatsApp · CMU</p>
          <h2>Recordatorios</h2>
          <p className="overlay-sub">
            Sesiones mensuales y fechas del próximo congreso en Tijuana.
          </p>
        </div>
        <div className="overlay-actions">
          <button type="button" className="text-btn accent" onClick={onHome}>
            Inicio
          </button>
          <button type="button" className="text-btn" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>

      <div className="reminders-body">
        <article className="reminder-card">
          <h3>Sesión mensual</h3>
          <p>
            Recibe un aviso antes de cada actividad académica mensual del
            Colegio.
          </p>
          <a
            className="solid-btn linkish"
            href={waLink(monthly)}
            target="_blank"
            rel="noreferrer"
          >
            Pedir por WhatsApp
          </a>
        </article>

        <article className="reminder-card highlight">
          <div className="reminder-visual">
            <img
              src="/assets/cmu-2027-kidney-tijuana.png"
              alt="51° Congreso Tijuana 2027"
            />
          </div>
          <h3>51° Congreso · Tijuana 2027</h3>
          <p>
            <strong>11–15 abril 2027</strong> · Tijuana, Baja California
            <br />
            Contacto CMU: 55 9000 2092 / 2093 · cmu.org.mx
          </p>
          <a
            className="solid-btn linkish"
            href={waLink(congress)}
            target="_blank"
            rel="noreferrer"
          >
            Recordarme el congreso
          </a>
        </article>

        <p className="trivia-legal">
          Demo: abre WhatsApp con un mensaje listo hacia el contacto del
          Colegio. La automatización completa (broadcast programado) se
          conectaría después con la cuenta oficial de CMU.
        </p>
      </div>
    </div>
  );
}
