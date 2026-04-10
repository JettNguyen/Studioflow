import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import './LoginPage.css';

export function LoginPage() {
  const { user, login, signup, loginWithGoogle } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (user) {
    return <Navigate to="/" replace />;
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (mode === 'login') {
        await login({ email, password });
      } else {
        await signup({ name, email, password });
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to continue');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-shell">
      <div className="login-left">
        <div className="login-brand">
          <div className="login-logo-mark">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="1.5" y="1.5" width="5.5" height="13" rx="2" fill="white" opacity="0.9" />
              <rect x="9" y="5.5" width="5.5" height="9" rx="2" fill="white" opacity="0.6" />
            </svg>
          </div>
          <span className="login-brand-name">Studioflow</span>
        </div>

        <h1 className="login-headline">Your music projects,<br />organized.</h1>
        <p className="login-subhead">
          A focused workspace for music teams — manage songs, stems, versions, and collaborators without the noise.
        </p>

        <ul className="login-features">
          <li>Version-controlled audio and video assets</li>
          <li>Notes and task tracking per song</li>
          <li>Google Drive sync for every project</li>
        </ul>
      </div>

      <div className="login-right">
        <article className="login-card">
          <div className="login-card__header">
            <h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
            <p>{mode === 'login' ? 'Log in to continue to your workspace.' : 'Get started — it takes less than a minute.'}</p>
          </div>

          <form className="form-stack" onSubmit={onSubmit}>
            {mode === 'signup' && (
              <div className="field">
                <label className="field-label" htmlFor="auth-name">Name</label>
                <input
                  id="auth-name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  required
                />
              </div>
            )}

            <div className="field">
              <label className="field-label" htmlFor="auth-email">Email</label>
              <input
                id="auth-email"
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="auth-password">Password</label>
              <input
                id="auth-password"
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
                required
                minLength={8}
              />
            </div>

            {error && <p className="form-error">{error}</p>}

            <button className="btn btn-primary btn-full" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Working...' : mode === 'login' ? 'Log in' : 'Create account'}
            </button>
          </form>

          <div className="login-divider">
            <span>or</span>
          </div>

          <button className="btn btn-ghost btn-full" type="button" onClick={loginWithGoogle}>
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
              <path d="M14.7 7.67c0-.53-.05-1.04-.13-1.54H7.5v2.91h4.04a3.47 3.47 0 0 1-1.5 2.27v1.88h2.42c1.42-1.3 2.24-3.22 2.24-5.52z" fill="#4285F4"/>
              <path d="M7.5 15c2.03 0 3.73-.67 4.97-1.81l-2.42-1.88a4.52 4.52 0 0 1-6.7-2.37H.86v1.94A7.5 7.5 0 0 0 7.5 15z" fill="#34A853"/>
              <path d="M3.35 8.94a4.5 4.5 0 0 1 0-2.88V4.12H.86a7.5 7.5 0 0 0 0 6.76l2.49-1.94z" fill="#FBBC05"/>
              <path d="M7.5 2.98a4.06 4.06 0 0 1 2.88 1.13l2.16-2.16A7.24 7.24 0 0 0 7.5 0 7.5 7.5 0 0 0 .86 4.12l2.49 1.94A4.47 4.47 0 0 1 7.5 2.98z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>

          <button
            className="login-toggle"
            type="button"
            onClick={() => setMode((m) => (m === 'login' ? 'signup' : 'login'))}
          >
            {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
          </button>
        </article>
      </div>
    </div>
  );
}
