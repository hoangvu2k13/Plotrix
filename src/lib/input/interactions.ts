import { evaluateCartesianAt } from '$lib/math/engine';
import type { CanvasRenderer } from '$lib/renderer/canvas';
import type { GraphState } from '$stores/graph.svelte';
import type { UiState } from '$stores/ui.svelte';
import { clamp } from '$utils/format';

export class InteractionManager {
	private pointers = new Map<number, { x: number; y: number }>();
	private lastPanPoint: { x: number; y: number } | null = null;
	private lastPanTimestamp = 0;
	private lastPinchDistance = 0;
	private velocity = { x: 0, y: 0 };
	private flingFrame = 0;
	private wheelFrame = 0;
	private wheelDelta = 0;
	private wheelAnchor = { x: 0, y: 0 };

	constructor(
		private canvas: HTMLCanvasElement,
		private graph: GraphState,
		private ui: UiState,
		private renderer: CanvasRenderer
	) {
		canvas.style.touchAction = 'none';
		canvas.addEventListener('wheel', this.handleWheel, { passive: false });
		canvas.addEventListener('dblclick', this.handleDoubleClick);
		canvas.addEventListener('pointerdown', this.handlePointerDown);
		canvas.addEventListener('pointermove', this.handlePointerMove);
		canvas.addEventListener('pointerup', this.handlePointerUp);
		canvas.addEventListener('pointercancel', this.handlePointerUp);
		canvas.addEventListener('pointerleave', this.handlePointerLeave);
		window.addEventListener('keydown', this.handleKeyDown);
	}

	destroy(): void {
		this.canvas.removeEventListener('wheel', this.handleWheel);
		this.canvas.removeEventListener('dblclick', this.handleDoubleClick);
		this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
		this.canvas.removeEventListener('pointermove', this.handlePointerMove);
		this.canvas.removeEventListener('pointerup', this.handlePointerUp);
		this.canvas.removeEventListener('pointercancel', this.handlePointerUp);
		this.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
		window.removeEventListener('keydown', this.handleKeyDown);

		if (this.flingFrame) {
			cancelAnimationFrame(this.flingFrame);
		}

		if (this.wheelFrame) {
			cancelAnimationFrame(this.wheelFrame);
		}
	}

	private getCanvasPoint(event: PointerEvent | WheelEvent) {
		const rect = this.canvas.getBoundingClientRect();
		return {
			x: event.clientX - rect.left,
			y: event.clientY - rect.top
		};
	}

	private stopFling(): void {
		if (this.flingFrame) {
			cancelAnimationFrame(this.flingFrame);
			this.flingFrame = 0;
			this.graph.view.isAnimating = false;
		}
	}

	private handleWheel = (event: WheelEvent): void => {
		event.preventDefault();
		this.stopFling();
		this.ui.pingInteraction();
		this.wheelDelta += event.deltaY;
		this.wheelAnchor = this.getCanvasPoint(event);

		if (this.wheelFrame) {
			return;
		}

		const step = () => {
			if (Math.abs(this.wheelDelta) < 0.5) {
				this.wheelFrame = 0;
				this.wheelDelta = 0;
				return;
			}

			const delta = clamp(this.wheelDelta, -120, 120);
			const direction = delta < 0 ? 1.08 : 0.92;
			this.ui.pingInteraction();
			this.graph.zoomTo(direction, this.wheelAnchor.x, this.wheelAnchor.y);
			this.wheelDelta *= 0.55;
			this.wheelFrame = requestAnimationFrame(step);
		};

		this.wheelFrame = requestAnimationFrame(step);
	};

	private handleDoubleClick = (): void => {
		this.ui.pingInteraction();

		if (this.graph.equations.some((equation) => equation.visible && !equation.errorMessage)) {
			this.graph.fitAll();
		} else {
			this.graph.resetView();
		}
	};

	private handlePointerDown = (event: PointerEvent): void => {
		if (event.button !== 0 && event.pointerType !== 'touch') {
			return;
		}

		this.stopFling();
		this.canvas.focus();
		this.canvas.setPointerCapture(event.pointerId);
		const point = this.getCanvasPoint(event);
		this.pointers.set(event.pointerId, point);
		this.lastPanPoint = point;
		this.lastPanTimestamp = performance.now();
		this.velocity = { x: 0, y: 0 };
		this.graph.view.isPanning = this.pointers.size === 1;
		this.renderer.setPointerPosition(point);
		this.ui.pingInteraction();

		if (this.pointers.size === 2) {
			const [first, second] = [...this.pointers.values()];

			if (first && second) {
				this.lastPinchDistance = Math.hypot(second.x - first.x, second.y - first.y);
			}
		}
	};

	private handlePointerMove = (event: PointerEvent): void => {
		const point = this.getCanvasPoint(event);

		if (this.pointers.has(event.pointerId)) {
			this.pointers.set(event.pointerId, point);
		}

		this.renderer.setPointerPosition(point);

		if (this.pointers.size >= 2) {
			const [first, second] = [...this.pointers.values()];

			if (!first || !second) {
				return;
			}

			const midpoint = {
				x: (first.x + second.x) / 2,
				y: (first.y + second.y) / 2
			};
			const distance = Math.hypot(second.x - first.x, second.y - first.y);

			if (this.lastPanPoint) {
				this.ui.pingInteraction();
				this.graph.panBy(midpoint.x - this.lastPanPoint.x, midpoint.y - this.lastPanPoint.y);
			}

			if (this.lastPinchDistance > 0 && distance > 0) {
				this.ui.pingInteraction();
				this.graph.zoomTo(distance / this.lastPinchDistance, midpoint.x, midpoint.y);
			}

			this.lastPanPoint = midpoint;
			this.lastPinchDistance = distance;
			this.ui.setTracePoint(null);
			return;
		}

		if (this.pointers.size === 1 && event.buttons !== 0) {
			const activePoint = [...this.pointers.values()][0]!;
			const now = performance.now();

			if (this.lastPanPoint) {
				const dx = activePoint.x - this.lastPanPoint.x;
				const dy = activePoint.y - this.lastPanPoint.y;
				this.ui.pingInteraction();
				this.graph.panBy(dx, dy);
				const elapsed = Math.max(16, now - this.lastPanTimestamp);
				this.velocity.x = dx / (elapsed / 16);
				this.velocity.y = dy / (elapsed / 16);
			}

			this.lastPanPoint = activePoint;
			this.lastPanTimestamp = now;
			this.graph.view.isPanning = true;
			this.ui.setTracePoint(null);
			return;
		}

		this.updateTrace(point.x, point.y);
	};

	private handlePointerUp = (event: PointerEvent): void => {
		this.pointers.delete(event.pointerId);
		this.canvas.releasePointerCapture(event.pointerId);

		if (this.pointers.size === 0) {
			this.graph.view.isPanning = false;
			this.lastPanPoint = null;
			this.lastPinchDistance = 0;
			this.maybeStartFling();
			return;
		}

		const remaining = [...this.pointers.values()][0]!;
		this.lastPanPoint = remaining;
	};

	private handlePointerLeave = (): void => {
		if (this.pointers.size === 0) {
			this.renderer.setPointerPosition(null);
			this.ui.setTracePoint(null);
		}
	};

	private maybeStartFling(): void {
		const speed = Math.hypot(this.velocity.x, this.velocity.y);

		if (speed < 0.4) {
			this.graph.view.isAnimating = false;
			return;
		}

		this.graph.view.isAnimating = true;

		const step = () => {
			this.ui.pingInteraction();
			this.graph.panBy(this.velocity.x, this.velocity.y);
			this.velocity.x *= 0.92;
			this.velocity.y *= 0.92;

			if (Math.hypot(this.velocity.x, this.velocity.y) < 0.35) {
				this.graph.view.isAnimating = false;
				this.flingFrame = 0;
				return;
			}

			this.flingFrame = requestAnimationFrame(step);
		};

		this.flingFrame = requestAnimationFrame(step);
	}

	private updateTrace(canvasX: number, canvasY: number): void {
		if (!this.graph.settings.traceMode) {
			this.ui.setTracePoint(null);
			return;
		}

		const [mathX] = this.renderer.canvasToMath(canvasX, canvasY);
		let best: {
			distance: number;
			x: number;
			y: number;
			equationId: string;
		} | null = null;

		for (const equation of this.graph.equations) {
			if (!equation.visible || equation.errorMessage || equation.isParametric) {
				continue;
			}

			const y = evaluateCartesianAt(equation.compiledExpression ?? equation.compiled, mathX);

			if (y === null) {
				continue;
			}

			const [, cy] = this.renderer.mathToCanvas(mathX, y);
			const distance = Math.abs(cy - canvasY);

			if (!best || distance < best.distance) {
				best = { distance, x: mathX, y, equationId: equation.id };
			}
		}

		if (best && best.distance < 42) {
			this.ui.setTracePoint({ x: best.x, y: best.y, equationId: best.equationId });
		} else {
			this.ui.setTracePoint(null);
		}
	}

	private handleKeyDown = (event: KeyboardEvent): void => {
		const target = event.target as HTMLElement | null;
		const isFormField =
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target?.isContentEditable;

		if (isFormField && event.key !== 'Escape') {
			return;
		}

		const modifier = event.metaKey || event.ctrlKey;
		const lower = event.key.toLowerCase();

		if (modifier && lower === 'z' && event.shiftKey) {
			event.preventDefault();
			this.graph.redoHistory();
			return;
		}

		if ((modifier && lower === 'y') || (modifier && lower === 'z' && event.shiftKey)) {
			event.preventDefault();
			this.graph.redoHistory();
			return;
		}

		if (modifier && lower === 'z') {
			event.preventDefault();
			this.graph.undoHistory();
			return;
		}

		if (modifier && lower === 'k') {
			event.preventDefault();
			this.ui.commandPaletteOpen = true;
			return;
		}

		if (modifier && lower === 'e') {
			event.preventDefault();
			const equation = this.graph.addEquation('');
			this.ui.activeEquationId = equation.id;
			return;
		}

		switch (event.key) {
			case 'ArrowLeft':
				event.preventDefault();
				this.ui.pingInteraction();
				this.graph.panBy(40, 0);
				break;
			case 'ArrowRight':
				event.preventDefault();
				this.ui.pingInteraction();
				this.graph.panBy(-40, 0);
				break;
			case 'ArrowUp':
				event.preventDefault();
				this.ui.pingInteraction();
				this.graph.panBy(0, 40);
				break;
			case 'ArrowDown':
				event.preventDefault();
				this.ui.pingInteraction();
				this.graph.panBy(0, -40);
				break;
			case '+':
			case '=':
				event.preventDefault();
				this.ui.pingInteraction();
				this.graph.zoomTo(1.12);
				break;
			case '-':
				event.preventDefault();
				this.ui.pingInteraction();
				this.graph.zoomTo(0.9);
				break;
			case '0':
				event.preventDefault();
				this.ui.pingInteraction();
				this.graph.resetView();
				break;
			case 'f':
			case 'F':
				event.preventDefault();
				this.ui.pingInteraction();
				this.graph.fitAll();
				break;
			case 'Escape':
				this.ui.commandPaletteOpen = false;
				this.ui.closeModal();
				this.ui.activeEquationId = null;
				break;
			case 'Tab':
				if (!this.graph.equations.length) {
					return;
				}

				event.preventDefault();

				if (!this.ui.activeEquationId) {
					this.ui.activeEquationId = this.graph.equations[0]!.id;
					return;
				}

				{
					const currentIndex = this.graph.equations.findIndex(
						(equation) => equation.id === this.ui.activeEquationId
					);
					const nextIndex = (currentIndex + 1) % this.graph.equations.length;
					this.ui.activeEquationId = this.graph.equations[nextIndex]!.id;
				}

				break;
			default:
				break;
		}
	};
}
