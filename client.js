window.__ModuleLoader__.load({
	id: "dsh-copilot-quota",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");

		const API = "/copilot-quota/api";
		const POLL_MS = 120000;

		//#region styles
		const css = [
			".cq-pill{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:999px;border:1px solid rgba(127,127,127,.28);background:rgba(127,127,127,.10);color:inherit;font-size:11px;line-height:1;font-variant-numeric:tabular-nums;cursor:pointer;white-space:nowrap;font-family:inherit}",
			".cq-pill:hover{background:rgba(127,127,127,.20)}",
			".cq-dot{width:6px;height:6px;border-radius:50%;background:#3fb950;flex:none}",
			".cq-dot[data-level=warn]{background:#d29922}",
			".cq-dot[data-level=low]{background:#f85149}",
			".cq-dot[data-level=muted]{background:#8b949e}",
		].join("");
		const tagId = "dsh-copilot-quota/style";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-copilot-quota";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		/** Poll the server half; keep the last reading on screen while refreshing. */
		function useQuota() {
			const [state, setState] = React.useState({ status: "loading", data: null, error: undefined });
			const alive = React.useRef(true);
			const load = React.useCallback((force) => {
				return fetch(force ? API + "?refresh=1" : API, { headers: { accept: "application/json" } })
					.then((response) => response.json())
					.then((data) => {
						if (alive.current) setState({ status: "ready", data: data, error: undefined });
					})
					.catch((error) => {
						if (!alive.current) return;
						const message = String((error && error.message) || error);
						setState((previous) => ({
							status: previous.data === null ? "error" : "ready",
							data: previous.data,
							error: message,
						}));
					});
			}, []);
			React.useEffect(() => {
				alive.current = true;
				load(false);
				const timer = setInterval(() => {
					load(false);
				}, POLL_MS);
				const onFocus = () => {
					load(false);
				};
				window.addEventListener("focus", onFocus);
				return () => {
					alive.current = false;
					clearInterval(timer);
					window.removeEventListener("focus", onFocus);
				};
			}, [load]);
			return [state, load];
		}

		/** Worst remaining percentage across the metered buckets. */
		function severityOf(buckets) {
			let worst = "ok";
			for (const bucket of buckets) {
				if (bucket.unlimited === true) continue;
				const percent = typeof bucket.percentRemaining === "number" ? bucket.percentRemaining : undefined;
				if (percent === undefined) continue;
				if (percent <= 15) worst = "low";
				else if (percent <= 40 && worst !== "low") worst = "warn";
			}
			return worst;
		}

		function amount(bucket) {
			if (bucket.unlimited === true) return "∞";
			if (typeof bucket.remaining !== "number") return "—";
			const total = bucket.entitlement;
			return typeof total === "number" && total > 0 ? bucket.remaining + "/" + total : String(bucket.remaining);
		}

		function tooltip(data) {
			const lines = [];
			lines.push("GitHub Copilot" + (data.login ? " — " + data.login : "") + (data.plan ? " (" + data.plan + (data.sku ? " / " + data.sku : "") + ")" : ""));
			for (const bucket of data.buckets ?? []) {
				let line = bucket.title + ": " + amount(bucket);
				if (bucket.unlimited === true) line += " — без ограничений";
				else if (typeof bucket.percentRemaining === "number") line += " — осталось " + Math.round(bucket.percentRemaining) + "%";
				if (typeof bucket.creditsUsed === "number" && bucket.creditsUsed > 0) line += ", кредитов израсходовано: " + bucket.creditsUsed;
				lines.push(line);
			}
			if (data.resetDate) lines.push("Сброс квоты: " + data.resetDate);
			if (data.fetchedAt) lines.push((data.cached === true ? "Из кэша: " : "Обновлено: ") + new Date(data.fetchedAt).toLocaleTimeString());
			if (data.error) lines.push("Ошибка: " + data.error);
			lines.push("Нажмите, чтобы обновить.");
			return lines.join("\n");
		}

		/** Compact pill in the composer tool row; hidden when no Copilot grant exists. */
		function QuotaBadge() {
			const [state, load] = useQuota();
			const data = state.data;
			if (data === null || data.signedIn !== true) return null;

			const buckets = Array.isArray(data.buckets) ? data.buckets : [];
			const primary = buckets.find((bucket) => bucket.id === "chat") ?? buckets[0];
			const level = buckets.length === 0 && data.error ? "muted" : severityOf(buckets);
			const text = primary === undefined ? "Copilot —" : "Copilot " + amount(primary);

			return React.createElement(
				"button",
				{
					type: "button",
					className: "cq-pill",
					title: tooltip(data),
					onClick: () => {
						load(true);
					},
				},
				React.createElement("span", { className: "cq-dot", "data-level": level }),
				React.createElement("span", null, text),
			);
		}

		/** Required service: the slot registry. */
		const inject = ["slots"];

		function apply(ctx) {
			ctx.slots.inject("conversation.input.right", () =>
				ctx.slots.register(
					{
						name: "conversation.input.right",
						id: "copilot-quota",
						order: 40,
						label: () => "Copilot",
					},
					QuotaBadge,
				),
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
