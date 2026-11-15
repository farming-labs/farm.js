import * as motion from "motion/react-client";

// Motion's entry for server components: lowercase components (`motion.div`) re-exported from
// another package's "use client" module.
export default function MotionPage() {
  return (
    <motion.div data-testid="motion-box" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      motion from a server component
    </motion.div>
  );
}
