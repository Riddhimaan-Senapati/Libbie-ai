import { m as motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";

/** A right-docked sheet used for the risk watchlist and handover export. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  width = 640,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: number;
}) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            className="absolute inset-0 bg-foreground/20 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-label={title}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 40 }}
            style={{ maxWidth: width }}
            className="absolute inset-y-0 right-0 flex w-full flex-col bg-background shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <h2 className="text-[15px] font-semibold">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" aria-hidden />
              </button>
            </header>
            <div className="scroll-soft selectable min-h-0 flex-1 overflow-y-auto p-5">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
