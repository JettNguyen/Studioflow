import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
export function LoginPage() {
    const { user, login, signup, loginWithGoogle } = useAuth();
    const [mode, setMode] = useState('login');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    if (user) {
        return _jsx(Navigate, { to: "/", replace: true });
    }
    const onSubmit = async (event) => {
        event.preventDefault();
        setError(null);
        setIsSubmitting(true);
        try {
            if (mode === 'login') {
                await login({ email, password });
            }
            else {
                await signup({ name, email, password });
            }
        }
        catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : 'Unable to continue');
        }
        finally {
            setIsSubmitting(false);
        }
    };
    return (_jsx("section", { className: "auth-shell", children: _jsxs("article", { className: "auth-card", children: [_jsxs("div", { children: [_jsx("span", { className: "badge", children: "Studioflow" }), _jsx("h2", { children: mode === 'login' ? 'Welcome back' : 'Create your workspace' }), _jsx("p", { children: "Secure projects, direct collaboration, and Google Drive-ready sessions for music teams." })] }), _jsxs("form", { className: "auth-form", onSubmit: onSubmit, children: [mode === 'signup' ? (_jsxs("label", { children: ["Name", _jsx("input", { value: name, onChange: (event) => setName(event.target.value), placeholder: "Jett", required: true })] })) : null, _jsxs("label", { children: ["Email", _jsx("input", { type: "email", value: email, onChange: (event) => setEmail(event.target.value), placeholder: "you@example.com", required: true })] }), _jsxs("label", { children: ["Password", _jsx("input", { type: "password", value: password, onChange: (event) => setPassword(event.target.value), placeholder: "At least 8 characters", required: true, minLength: 8 })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, _jsx("button", { className: "button", type: "submit", disabled: isSubmitting, children: isSubmitting ? 'Working...' : mode === 'login' ? 'Log in' : 'Create account' })] }), _jsx("button", { className: "button button-ghost auth-google", type: "button", onClick: loginWithGoogle, children: "Continue with Google" }), _jsx("button", { className: "auth-toggle", type: "button", onClick: () => setMode((current) => (current === 'login' ? 'signup' : 'login')), children: mode === 'login' ? 'Need an account? Sign up' : 'Already have an account? Log in' })] }) }));
}
