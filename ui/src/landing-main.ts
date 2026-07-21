import {
  getAuth0Config,
  getAuth0UserLabel,
  handleAuthRedirect,
  isAuth0Authenticated,
  loginWithAuth0,
  logoutAuth0,
} from "./auth.js";

const authControls = document.getElementById("auth-controls")!;
const authLoginBtn = document.getElementById("auth-login") as HTMLButtonElement;
const authLogoutBtn = document.getElementById("auth-logout") as HTMLButtonElement;
const authStatusEl = document.getElementById("auth-status")!;

async function syncAuthUi(): Promise<void> {
  const auth0Config = getAuth0Config();
  if (!auth0Config) {
    authControls.hidden = true;
    return;
  }

  authControls.hidden = false;
  await handleAuthRedirect();

  const authenticated = await isAuth0Authenticated();
  authLoginBtn.hidden = authenticated;
  authLogoutBtn.hidden = !authenticated;
  authStatusEl.textContent = authenticated ? await getAuth0UserLabel() : "Not signed in";
}

authLoginBtn.addEventListener("click", () => void loginWithAuth0());
authLogoutBtn.addEventListener("click", () => {
  void logoutAuth0();
});

void syncAuthUi();
