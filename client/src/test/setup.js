import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
if (!window.matchMedia) window.matchMedia = (query) => ({ matches:false, media:query, onchange:null, addListener:()=>{}, removeListener:()=>{}, addEventListener:()=>{}, removeEventListener:()=>{}, dispatchEvent:()=>false });
window.scrollTo = vi.fn();
Element.prototype.scrollIntoView = vi.fn();
URL.createObjectURL = vi.fn(()=>'blob:eventtracker-preview');
URL.revokeObjectURL = vi.fn();
if (!navigator.mediaDevices) Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:vi.fn().mockRejectedValue(new Error('Camera is not available in this test browser.'))}});
else if (!navigator.mediaDevices.getUserMedia) navigator.mediaDevices.getUserMedia=vi.fn().mockRejectedValue(new Error('Camera is not available in this test browser.'));
afterEach(() => { cleanup(); });
