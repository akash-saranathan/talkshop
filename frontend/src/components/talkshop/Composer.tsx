/** Talkshop's input: typing (with phone-style autocorrect), voice, and a
 *  pasted or attached photo for "find me something like this". */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, ImagePlus, Mic, Square, X } from "lucide-react";
import { autocorrectLastWord, autocorrectOnType, type Correction } from "../../utils/autocorrect";
import { cx } from "../ui";

async function shrinkImage(file: Blob, maxDim = 768, quality = 0.75): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

export default function Composer({ disabled, onSend }: { disabled: boolean; onSend: (text: string, image?: string) => void }) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastFix = useRef<Correction | null>(null);
  const recognition = useRef<SpeechRecognitionInstance | null>(null);

  useEffect(() => {                         // grow with the text
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const send = (raw = text) => {
    const msg = autocorrectLastWord(raw.trim());
    if ((!msg && !image) || disabled) return;
    onSend(msg, image ?? undefined);
    setText(""); setImage(null); setNote(null); lastFix.current = null;
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const fix = lastFix.current;
    if (e.key === "Backspace" && fix && text === fix.corrected) {   // undo the autocorrect
      e.preventDefault(); lastFix.current = null; setText(fix.original); return;
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const attach = async (file: Blob | null | undefined) => {
    if (!file) return;
    try { setImage(await shrinkImage(file)); setNote(null); }
    catch { setNote("Couldn't read that image — try another one."); }
  };

  const toggleVoice = () => {
    if (listening) { recognition.current?.stop(); return; }
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) { setNote("Voice input needs Chrome or Edge."); return; }
    const rec = new Ctor();
    rec.lang = "en-US"; rec.interimResults = true; rec.continuous = false;
    let finalText = "";
    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalText += t; else interim += t;
      }
      setText((finalText + interim).trim());
    };
    rec.onerror = (ev) => {
      if (ev.error !== "no-speech" && ev.error !== "aborted")
        setNote(ev.error === "not-allowed" ? "Microphone access was blocked in your browser settings." : "Couldn't hear that — try again.");
    };
    rec.onend = () => {
      setListening(false); recognition.current = null;
      if (finalText.trim()) send(finalText);        // speaking then pausing sends it
    };
    recognition.current = rec;
    setNote(null); setListening(true); rec.start();
  };

  return (
    <div className="border-t border-line p-3 bg-canvas">
      {image && (
        <div className="relative inline-block mb-2">
          <img src={image} alt="Your photo" className="h-16 w-16 rounded-xl object-cover border border-line" />
          <button onClick={() => setImage(null)} aria-label="Remove photo"
            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-ink text-canvas grid place-items-center"><X size={11} /></button>
        </div>
      )}
      {note && <p className="text-xs text-bad mb-1.5">{note}</p>}
      <div className={cx("flex items-end gap-1.5 rounded-2xl border bg-panel px-2 py-1.5 transition-colors",
        listening ? "border-talk" : "border-transparent focus-within:border-line-strong")}>
        <button type="button" onClick={() => fileInput.current?.click()} title="Search with a photo"
          className="w-8 h-8 grid place-items-center rounded-full text-muted hover:text-ink shrink-0"><ImagePlus size={17} /></button>
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => { attach(e.target.files?.[0]); e.target.value = ""; }} />
        <textarea
          ref={area} rows={1} value={text} disabled={disabled && !listening}
          placeholder={listening ? "Listening…" : image ? "Add a note (optional)…" : "Ask Talkshop…"}
          onChange={(e) => {
            const fix = autocorrectOnType(text, e.target.value);
            lastFix.current = fix;
            setText(fix ? fix.corrected : e.target.value);
          }}
          onKeyDown={onKey}
          onPaste={(e) => {
            const item = Array.from(e.clipboardData.items).find((it) => it.type.startsWith("image/"));
            if (item) { e.preventDefault(); attach(item.getAsFile()); }
          }}
          className="flex-1 resize-none bg-transparent text-sm leading-6 py-1 outline-none placeholder:text-faint max-h-[120px]"
          aria-label="Message Talkshop"
        />
        <button type="button" onClick={toggleVoice} title={listening ? "Stop" : "Speak"}
          className={cx("w-8 h-8 grid place-items-center rounded-full shrink-0",
            listening ? "bg-talk text-white animate-pulse" : "text-muted hover:text-ink")}>
          {listening ? <Square size={13} /> : <Mic size={17} />}
        </button>
        <button type="button" onClick={() => send()} disabled={disabled || (!text.trim() && !image)} aria-label="Send"
          className="w-8 h-8 grid place-items-center rounded-full bg-talk text-white shrink-0 disabled:opacity-30"><ArrowUp size={16} /></button>
      </div>
    </div>
  );
}
