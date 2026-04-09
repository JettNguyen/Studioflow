import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
export function AppShell() {
    const { user, logout } = useAuth();
    return (_jsxs("div", { className: "app-bg", children: [_jsx("div", { className: "orb orb-a" }), _jsx("div", { className: "orb orb-b" }), _jsxs("header", { className: "topbar", children: [_jsx("h1", { children: "Studioflow" }), _jsxs("nav", { children: [_jsx(NavLink, { to: "/", children: "Projects" }), _jsx(NavLink, { to: "/drive-sync", children: "Drive Sync" }), _jsx(NavLink, { to: "/ai-lab", children: "AI Lab" })] }), _jsxs("div", { className: "chip-wrap topbar-actions", children: [_jsx("span", { className: "topbar-user", children: user?.name }), _jsx("button", { className: "button button-ghost", onClick: () => logout(), children: "Log out" })] })] }), _jsx("main", { className: "content-wrap", children: _jsx(Outlet, {}) })] }));
}
