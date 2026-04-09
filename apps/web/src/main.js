import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import App from './App';
import './styles.css';
ReactDOM.createRoot(document.getElementById('root')).render(_jsx(React.StrictMode, { children: _jsx(AuthProvider, { children: _jsx(BrowserRouter, { future: {
                v7_startTransition: true,
                v7_relativeSplatPath: true
            }, children: _jsx(App, {}) }) }) }));
