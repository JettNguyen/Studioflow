import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

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
    <section className="auth-shell">
      <article className="auth-card">
        <div>
          <span className="badge">Studioflow</span>
          <h2>{mode === 'login' ? 'Welcome back' : 'Create your workspace'}</h2>
          <p>Secure projects, direct collaboration, and Google Drive-ready sessions for music teams.</p>
        </div>

        <form className="auth-form" onSubmit={onSubmit}>
          {mode === 'signup' ? (
            <label>
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Jett" required />
            </label>
          ) : null}

          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              required
              minLength={8}
            />
          </label>

          {error ? <p className="form-error">{error}</p> : null}

          <button className="button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Working...' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>

        <button className="button button-ghost auth-google" type="button" onClick={loginWithGoogle}>
          Continue with Google
        </button>

        <button
          className="auth-toggle"
          type="button"
          onClick={() => setMode((current) => (current === 'login' ? 'signup' : 'login'))}
        >
          {mode === 'login' ? 'Need an account? Sign up' : 'Already have an account? Log in'}
        </button>
      </article>
    </section>
  );
}
