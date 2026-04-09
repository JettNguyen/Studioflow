import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { NavLink, Outlet } from 'react-router-dom';
export function AppShell() {
    return (_jsxs("div", { className: "app-bg", children: [_jsx("div", { className: "orb orb-a" }), _jsx("div", { className: "orb orb-b" }), _jsxs("header", { className: "topbar", children: [_jsx("h1", { children: "Studioflow" }), _jsxs("nav", { children: [_jsx(NavLink, { to: "/", children: "Projects" }), _jsx("a", { href: "#", children: "Drive Sync" }), _jsx("a", { href: "#", children: "AI Lab" })] }), _jsx("button", { className: "button button-ghost", children: "Invite" })] }), _jsx("main", { className: "content-wrap", children: _jsx(Outlet, {}) })] }));
}
