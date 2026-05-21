import { Box, Typography, IconButton, Chip, Divider } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import type { AiUsageEvent } from "../api/client.js";

interface AiEventDetailProps {
	event: AiUsageEvent;
	onClose: () => void;
}

const DETAIL_FONT_SIZE = {
	title: "20px",
	section: "16px",
	body: "16px",
	value: "16px",
	code: "14px",
};

function DetailRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
	return (
		<Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 2, py: 0.75 }}>
			<Typography variant="caption" sx={{ color: "text.secondary", fontSize: DETAIL_FONT_SIZE.body, flexShrink: 0, minWidth: 140 }}>
				{label}
			</Typography>
			<Typography
				variant="body2"
				sx={{
					fontSize: DETAIL_FONT_SIZE.value,
					fontWeight: "var(--font-weight-medium)",
					textAlign: "right",
					wordBreak: "break-all",
					fontFamily: mono ? "var(--font-mono)" : "inherit",
				}}
			>
				{value}
			</Typography>
		</Box>
	);
}

function formatTimestamp(iso: string): string {
	try {
		const date = new Date(iso);
		return date.toLocaleString();
	} catch {
		return iso;
	}
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	return `${(ms / 60000).toFixed(1)}m`;
}

function formatTokens(tokens: number | null | undefined): string {
	if (tokens == null) return "—";
	return tokens.toLocaleString();
}

function formatJson(jsonString: string | null | undefined): { formatted: string | null; content: unknown } {
	if (!jsonString) return { formatted: null, content: null };
	try {
		const parsed = JSON.parse(jsonString);
		// Extract content: try top-level first, then OpenAI ChatCompletion format (choices[0].message.content)
		const content = parsed.content
			?? parsed.choices?.[0]?.message?.content
			?? null;
		return {
			formatted: JSON.stringify(parsed, null, 2),
			content,
		};
	} catch {
		return { formatted: jsonString, content: null };
	}
}

function formatContentAsJson(content: unknown): string | null {
	if (content == null) return null;
	if (typeof content === "string") {
		try {
			const parsed = JSON.parse(content);
			return JSON.stringify(parsed, null, 2);
		} catch {
			// Not valid JSON — display as a JSON string literal
			return JSON.stringify(content);
		}
	}
	return JSON.stringify(content, null, 2);
}

export function AiEventDetail({ event, onClose }: AiEventDetailProps) {
	const isSuccess = event.status === "success";
	const isError = event.status === "error";

	return (
		<Box
			data-testid="ai-event-detail"
			sx={{
				display: "flex",
				flexDirection: "column",
				height: "100%",
				overflow: "hidden",
			}}
		>
			<Box sx={{
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				px: "var(--spacing-lg)",
				minHeight: "var(--app-shell-header-height, 42px)",
				borderBottom: "1px solid",
				borderColor: "divider",
			}}>
				<Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
					<Typography
						variant="subtitle2"
						sx={{
							fontSize: DETAIL_FONT_SIZE.title,
							fontWeight: "var(--font-weight-bold)",
							fontFamily: "var(--font-display)",
							letterSpacing: "0.05em",
						}}
					>
						Event Detail
					</Typography>
					<Chip
						label={event.status}
						size="small"
						color={isSuccess ? "success" : isError ? "error" : "default"}
						variant="outlined"
						sx={{ fontSize: DETAIL_FONT_SIZE.body, height: 28 }}
					/>
				</Box>
				<IconButton size="small" onClick={onClose} aria-label="Close detail" data-testid="ai-event-detail-close">
					<CloseIcon fontSize="small" />
				</IconButton>
			</Box>

			<Box sx={{ flex: 1, overflowY: "auto", px: "var(--spacing-lg)", py: "var(--spacing-md)" }}>
				<Typography variant="caption" sx={{ color: "text.disabled", fontSize: DETAIL_FONT_SIZE.section, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "var(--font-weight-semibold)" }}>
					Model
				</Typography>
				<Box sx={{ mt: 0.5, mb: 2, p: 1.5, bgcolor: "background.default", borderRadius: "var(--radius-sm)", border: "1px solid", borderColor: "divider" }}>
					<Typography variant="body2" sx={{ fontSize: DETAIL_FONT_SIZE.title, fontWeight: "var(--font-weight-semibold)" }}>
						{event.model}
					</Typography>
				</Box>

				<Typography variant="caption" sx={{ color: "text.disabled", fontSize: DETAIL_FONT_SIZE.section, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "var(--font-weight-semibold)" }}>
					Connection
				</Typography>
				<Box sx={{ mt: 0.5, mb: 2, p: 1.5, bgcolor: "background.default", borderRadius: "var(--radius-sm)", border: "1px solid", borderColor: "divider" }}>
					<DetailRow label="Target" value={event.targetName || "—"} />
					<DetailRow label="Session" value={event.sessionName || "—"} />
					{event.projectId && <DetailRow label="Project" value={event.projectId} mono />}
					<DetailRow label="Window" value={event.windowNumber != null ? event.windowNumber.toString() : "—"} />
				</Box>

				<Typography variant="caption" sx={{ color: "text.disabled", fontSize: DETAIL_FONT_SIZE.section, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "var(--font-weight-semibold)" }}>
					Performance
				</Typography>
				<Box sx={{ mt: 0.5, mb: 2, p: 1.5, bgcolor: "background.default", borderRadius: "var(--radius-sm)", border: "1px solid", borderColor: "divider" }}>
					<DetailRow label="Duration" value={formatDuration(event.durationMs)} />
					<DetailRow label="Prompt Tokens" value={formatTokens(event.promptTokens)} />
					<DetailRow label="Completion Tokens" value={formatTokens(event.completionTokens)} />
					<DetailRow label="Total Tokens" value={formatTokens(event.totalTokens)} />
				</Box>

				{(event.estimatedCost != null) && (
					<>
						<Typography variant="caption" sx={{ color: "text.disabled", fontSize: DETAIL_FONT_SIZE.section, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "var(--font-weight-semibold)" }}>
							Cost
						</Typography>
						<Box sx={{ mt: 0.5, mb: 2, p: 1.5, bgcolor: "background.default", borderRadius: "var(--radius-sm)", border: "1px solid", borderColor: "divider" }}>
							<DetailRow label="Estimated" value={`$${event.estimatedCost.toFixed(4)}`} />
						</Box>
					</>
				)}

				{(() => {
					const { formatted, content } = formatJson(event.responseJson);
					const contentJson = formatContentAsJson(content);
					if (!formatted) return null;
					return (
						<>
							<Typography variant="caption" sx={{ color: "text.disabled", fontSize: DETAIL_FONT_SIZE.section, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "var(--font-weight-semibold)" }}>
								AI Response
							</Typography>
							<Box sx={{ mt: 0.5, mb: 2, p: 1.5, bgcolor: "background.default", borderRadius: "var(--radius-sm)", border: "1px solid", borderColor: "divider" }}>
								<Typography variant="body2" component="pre" sx={{ fontSize: DETAIL_FONT_SIZE.code, fontFamily: "var(--font-mono)", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", m: 0 }}>
									{formatted}
								</Typography>
							</Box>
							{contentJson != null && (
								<>
									<Typography variant="caption" sx={{ color: "text.disabled", fontSize: DETAIL_FONT_SIZE.section, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "var(--font-weight-semibold)" }}>
										Content
									</Typography>
									<Box sx={{ mt: 0.5, mb: 2, p: 1.5, bgcolor: "background.default", borderRadius: "var(--radius-sm)", border: "1px solid", borderColor: "divider" }}>
										<Typography variant="body2" component="pre" sx={{ fontSize: DETAIL_FONT_SIZE.code, fontFamily: "var(--font-mono)", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", m: 0 }}>
											{contentJson}
										</Typography>
									</Box>
								</>
							)}
						</>
					);
				})()}

				{isError && event.errorMessage && (
					<>
						<Typography variant="caption" sx={{ color: "text.disabled", fontSize: DETAIL_FONT_SIZE.section, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "var(--font-weight-semibold)" }}>
							Error
						</Typography>
						<Box sx={{ mt: 0.5, mb: 2, p: 1.5, bgcolor: "error.main", color: "error.contrastText", borderRadius: "var(--radius-sm)", border: "1px solid", borderColor: "error.dark" }}>
							<Typography variant="body2" sx={{ fontSize: DETAIL_FONT_SIZE.body, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
								{event.errorMessage}
							</Typography>
						</Box>
					</>
				)}

				<Divider sx={{ my: 1.5 }} />

				<Typography variant="caption" sx={{ color: "text.disabled", fontSize: DETAIL_FONT_SIZE.section, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "var(--font-weight-semibold)" }}>
					Metadata
				</Typography>
				<Box sx={{ mt: 0.5, mb: 2, p: 1.5, bgcolor: "background.default", borderRadius: "var(--radius-sm)", border: "1px solid", borderColor: "divider" }}>
					<DetailRow label="ID" value={event.id} mono />
					<DetailRow label="Created" value={formatTimestamp(event.createdAt)} />
				</Box>
			</Box>
		</Box>
	);
}
