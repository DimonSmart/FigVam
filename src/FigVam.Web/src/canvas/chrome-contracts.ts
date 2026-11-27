import type { Theme } from '../core/tokens/token-model';

export interface CanvasChromeState {caption:string;zoomPercent:number;available:boolean;hint:string}
export interface FeedbackState {status:string;diagnostics:readonly string[];canRetry:boolean}
export interface PreviewChromeState {active:boolean;available:boolean;theme:Theme;canGoBack:boolean}
export interface CanvasChromeSink {patch(next:Partial<CanvasChromeState>):void}
export interface RenderFeedbackSink {getSnapshot():FeedbackState;patch(next:Partial<FeedbackState>):void;addDiagnostic(message:string):void}
export interface PreviewChromeSink {
  patch(next:Partial<PreviewChromeState>):void;
  design:RenderFeedbackSink;
  preview:RenderFeedbackSink;
}
