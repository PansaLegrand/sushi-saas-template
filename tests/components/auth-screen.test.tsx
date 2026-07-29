import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AuthScreen from "@/components/auth/auth-screen";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  sendVerificationEmail: vi.fn(),
  signInEmail: vi.fn(),
  signInSocial: vi.fn(),
  signUpEmail: vi.fn(),
  useSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ locale: "en" }),
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const messages: Record<string, string> = {
      captchaFailed: "Verification failed. Please try again.",
      captchaRequired: "Please complete the verification challenge.",
      continueWithGoogle: "Continue with Google",
      email: "Email",
      forgotPassword: "Forgot password?",
      haveAccount: "Already have an account?",
      linkSignIn: "Log in",
      linkSignUp: "Sign up",
      msgVerifyEmailResent: "Verification email sent again.",
      msgVerifyEmailPending:
        "This account still needs email verification. Use the original email, or resend it below.",
      msgVerifyEmailSent:
        "Account created. Check your email to verify your account before logging in.",
      name: "Name",
      noAccount: "Don't have an account?",
      orContinueWith: "or continue with",
      password: "Password",
      pleaseWait: "Please wait...",
      resendVerificationEmail: "Resend email",
      sending: "Sending...",
      signInSubtitle: "Use your credentials to access your dashboard.",
      signInTitle: "Welcome back",
      signUpSubtitle: "Start your journey by filling in the details below.",
      signUpTitle: "Create an account",
      submitSignIn: "Log in",
      submitSignUp: "Create Account",
      useDifferentEmail: "Use a different email",
      verifyEmailInstructions:
        "Open the link in that email to verify your address. After verification, you will be signed in automatically.",
      verifyEmailStatusTitle: "Verification email sent",
      verifyEmailSubtitle:
        "Use the verification link to finish creating your account.",
      verifyEmailTitle: "Check your email",
    };

    return (key: string) => messages[key] ?? key;
  },
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { sendVerificationEmail: mocks.sendVerificationEmail },
  signIn: { email: mocks.signInEmail, social: mocks.signInSocial },
  signUp: { email: mocks.signUpEmail },
  useSession: mocks.useSession,
}));

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.sendVerificationEmail.mockReset();
  mocks.signInEmail.mockReset();
  mocks.signInSocial.mockReset();
  mocks.signUpEmail.mockReset();
  mocks.useSession.mockReset();

  mocks.sendVerificationEmail.mockResolvedValue({ error: null });
  mocks.signUpEmail.mockResolvedValue({ error: null });
  mocks.useSession.mockReturnValue({ data: null });
});

describe("AuthScreen signup verification", () => {
  it("keeps the user on a verification step after signup", async () => {
    const user = userEvent.setup();

    render(<AuthScreen initialMode="signUp" />);

    await user.type(screen.getByLabelText("Name"), "Jane Doe");
    await user.type(screen.getByLabelText("Email"), "jane@example.com");
    await user.type(screen.getByLabelText("Password"), "correct-horse");
    await user.click(screen.getByRole("button", { name: "Create Account" }));

    await screen.findByRole("heading", { name: "Check your email" });

    expect(mocks.signUpEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        callbackURL: "/account/billing",
        email: "jane@example.com",
        fetchOptions: { headers: {} },
        name: "Jane Doe",
        password: "correct-horse",
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("jane@example.com");
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("renders a catalogued rate-limit error returned by the auth endpoint", async () => {
    const user = userEvent.setup();
    mocks.signUpEmail.mockResolvedValue({
      data: null,
      error: {
        code: -1,
        error_code: "REQUEST_RATE_LIMITED",
        message: "Server-owned English fallback",
        status: 429,
      },
    });

    render(<AuthScreen initialMode="signUp" />);

    await user.type(screen.getByLabelText("Email"), "jane@example.com");
    await user.type(screen.getByLabelText("Password"), "correct-horse");
    await user.click(screen.getByRole("button", { name: "Create Account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many requests. Please wait a moment and try again.",
    );
    expect(
      screen.queryByText("Server-owned English fallback"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Check your email" }),
    ).not.toBeInTheDocument();
  });

  it("resends verification email only from the explicit pending action", async () => {
    const user = userEvent.setup();

    render(<AuthScreen initialMode="signUp" />);

    await user.type(screen.getByLabelText("Email"), "jane@example.com");
    await user.type(screen.getByLabelText("Password"), "correct-horse");
    await user.click(screen.getByRole("button", { name: "Create Account" }));
    await screen.findByRole("heading", { name: "Check your email" });

    expect(mocks.sendVerificationEmail).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Resend email" }));

    await waitFor(() =>
      expect(mocks.sendVerificationEmail).toHaveBeenCalledWith({
        callbackURL: "/account/billing",
        email: "jane@example.com",
        fetchOptions: { headers: {} },
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Verification email sent again.",
    );
  });

  it("turns an unverified login attempt into the pending verification step", async () => {
    const user = userEvent.setup();
    mocks.signInEmail.mockResolvedValue({
      data: null,
      error: { message: "Email not verified" },
    });

    render(<AuthScreen initialMode="signIn" />);

    await user.type(screen.getByLabelText("Email"), "jane@example.com");
    await user.type(screen.getByLabelText("Password"), "correct-horse");
    await user.click(screen.getAllByRole("button", { name: "Log in" })[1]);

    await screen.findByRole("heading", { name: "Check your email" });

    expect(mocks.sendVerificationEmail).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "This account still needs email verification.",
    );
    expect(screen.getByRole("status")).toHaveTextContent("jane@example.com");
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("returns a signed-in customer to a validated checkout callback", async () => {
    const user = userEvent.setup();
    mocks.signInEmail.mockResolvedValue({ data: {}, error: null });

    render(
      <AuthScreen initialMode="signIn" callbackUrl="/en/pricing?plan=max" />,
    );

    await user.type(screen.getByLabelText("Email"), "jane@example.com");
    await user.type(screen.getByLabelText("Password"), "correct-horse");
    await user.click(screen.getAllByRole("button", { name: "Log in" })[1]);

    await waitFor(() =>
      expect(mocks.signInEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          callbackURL: "/en/pricing?plan=max",
        }),
      ),
    );
    expect(mocks.replace).toHaveBeenCalledWith("/en/pricing?plan=max");
  });

  it("carries the validated checkout callback into two-factor verification", async () => {
    const user = userEvent.setup();
    mocks.signInEmail.mockResolvedValue({
      data: { twoFactorRedirect: true },
      error: null,
    });

    render(
      <AuthScreen
        initialMode="signIn"
        callbackUrl="/pricing?org=team-workspace"
      />,
    );

    await user.type(screen.getByLabelText("Email"), "jane@example.com");
    await user.type(screen.getByLabelText("Password"), "correct-horse");
    await user.click(screen.getAllByRole("button", { name: "Log in" })[1]);

    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(
        "/two-factor?callbackUrl=%2Fpricing%3Forg%3Dteam-workspace",
      ),
    );
  });

  it("rejects an external authentication callback", async () => {
    const user = userEvent.setup();
    mocks.signInEmail.mockResolvedValue({ data: {}, error: null });

    render(
      <AuthScreen
        initialMode="signIn"
        callbackUrl="https://malicious.example/collect"
      />,
    );

    await user.type(screen.getByLabelText("Email"), "jane@example.com");
    await user.type(screen.getByLabelText("Password"), "correct-horse");
    await user.click(screen.getAllByRole("button", { name: "Log in" })[1]);

    await waitFor(() =>
      expect(mocks.signInEmail).toHaveBeenCalledWith(
        expect.objectContaining({ callbackURL: "/account/billing" }),
      ),
    );
    expect(mocks.replace).toHaveBeenCalledWith("/account/billing");
  });
});
