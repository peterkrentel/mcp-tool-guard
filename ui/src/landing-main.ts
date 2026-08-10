import {
  getIdpConfig,
  getUserLabel,
  handleAuthRedirect,
  isSignedIn,
  login,
  logout,
} from "./auth.js";

const authControls = document.getElementById("auth-controls")!;
const authLoginBtn = document.getElementById("auth-login") as HTMLButtonElement;
const authLogoutBtn = document.getElementById("auth-logout") as HTMLButtonElement;
const authStatusEl = document.getElementById("auth-status")!;

async function syncAuthUi(): Promise<void> {
  const idpConfig = getIdpConfig();
  if (!idpConfig) {
    authControls.hidden = true;
    return;
  }

  authControls.hidden = false;
  await handleAuthRedirect();

  const authenticated = await isSignedIn();
  authLoginBtn.hidden = authenticated;
  authLogoutBtn.hidden = !authenticated;
  authStatusEl.textContent = authenticated ? await getUserLabel() : "Not signed in";
}

authLoginBtn.addEventListener("click", () => void login());
authLogoutBtn.addEventListener("click", () => {
  void logout();
});

void syncAuthUi();
