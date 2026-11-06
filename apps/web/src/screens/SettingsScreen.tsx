import { useState } from "react";
import { api, ApiError } from "../api";
import { SemestersEditor } from "../components/SemestersEditor";
import { SegmentedControl } from "../components/SegmentedControl";
import { AccountSection } from "../login/AccountPanels";
import type { Account } from "../login/api";
import { useSession } from "../login/session-context";
import { Screen } from "../shell/Screen";
import { paletteOf, setLook, showPalette, useLook, type Look, type Palette } from "../theme";

const LOOK_OPTIONS: readonly { value: Look; label: string }[] = [
  { value: "auto", label: "Match device" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const PALETTE_OPTIONS: readonly { value: Palette; label: string }[] = [
  { value: "dusk", label: "Dusk" },
  { value: "slate", label: "Slate" },
];

export function SettingsScreen() {
  const look = useLook();
  const session = useSession();
  const student = session.user.role === "student";
  return (
    <Screen title="Settings">
      <AccountSection user={session.user} onUser={session.replace} onSignedOut={session.signOut} />
      {student ? <SemestersEditor /> : null}
      <section className="group">
        <h2 className="group-header">Look</h2>
        <div className="group-card group-fields">
          <div className="field">
            <span className="field-label">Look</span>
            <SegmentedControl label="Look" value={look} options={LOOK_OPTIONS} onChange={setLook} />
          </div>
          <ColorField />
        </div>
        <p className="group-footer">
          Match device follows this device's light or dark setting. Color goes with your account to every device.
        </p>
      </section>
    </Screen>
  );
}

/** The account's color scheme: shown at once, saved to the account, and put back if saving fails. */
function ColorField() {
  const session = useSession();
  const saved = paletteOf(session.user.palette);
  const [picked, setPicked] = useState<Palette | undefined>();
  const [error, setError] = useState<string | undefined>();

  return (
    <div className="field">
      <span className="field-label">Color</span>
      <SegmentedControl
        label="Color"
        value={picked ?? saved}
        options={PALETTE_OPTIONS}
        onChange={(palette) => {
          if (palette === (picked ?? saved)) return;
          setPicked(palette);
          setError(undefined);
          showPalette(palette);
          void api<Account>("/api/me/palette", { method: "PUT", json: { palette } })
            .then((account) => {
              session.replace(account);
            })
            .catch((caught: unknown) => {
              showPalette(saved);
              setError(caught instanceof ApiError ? caught.message : "Your color could not be saved. Try again.");
            })
            .finally(() => {
              setPicked(undefined);
            });
        }}
      />
      {error !== undefined ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
