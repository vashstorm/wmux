import { Box, Typography, IconButton, Chip, Divider } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import type { AiUsageEvent } from "../api/client.js";

interface AiEventDetailProps {
	event: AiUsageEvent;
	onClose: () => void;
}

function DetailRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
	return (
		<Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", py: 0.5 }}>
			<Typography variant="caption" sx={{ color: "text.secondary", fontSize: "var(--font-size-xs)", flexShrink: 0, minWidth: 100 }}>
				{label}
			</Typography>
			<Typography
				variant="body2"
				sx={{
					fontSize: "var(--font-size-sm)",
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
							fontSize: "var(--font-size-md)",
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
						sx={{ fontSize: "var(--font-size-xs)", height: 20 }}
					/>
				</Box>
				<IconButton size="small" onClick={onClose} aria-label="Close detail" data-testid="ai-event-detail-close">
					<CloseIcon fontSize="small" />
				</IconButton>
			</Box>

			<Box sx={{ flex: 1, overflowY: "auto", px: "var(--spacing-lg)", py: "var(--spacing-md)" }}>
				<Typography variant="caption" sx={{ color: "text.disabled", fontSize: "var(--font-size-xs)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "var(--font-weight-semibold)" }}>
					Model
				</Typography>
				<Box sx={{ mt: 0.5, mb: 2, p: 1.5, bgcolor: "background.default", borderRadius: "var(--radius-sm)", border: "1px solid", borderColor: "divider" }}>
					<Typography variant="body2" sx={{ fontSize: "var(--font-size-md)", fontWeight: "var(--font-weight-semibold)" }}>
						{event.provider}/{event.model}
					</Typography>
				</Box>

				<Typography variant="caption" sx={{ color: "text.disabled", fontSize: "var(--font-size-xs)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "var(--font-weight-semibold)" }}>
					Connection
				</Typography>
				<Box sx={{ mt: 0.5, mb: 2, p: 1.5, bgcolor: "background.default", borderRadius: "var(--radius-sm)", border: "1px solid", borderColor: "divider" }}>
					<DetailRow label="Target" value={event.targetName || "—"} />
					<DetailRow label="Session" value={event.sessionName || "—"} />
					{event.projectId && <DetailRow label="Project" value={event.projectId} mono />}
					<DetailRow label="Window" value={event.windowNumber != null ? event.windowNumber.toString() : "—"} />
				</Box>

				<Typography variant="caption" sx={{ color: "text.disabled", fontSize: "var(--font-size-xs)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "var(--font-weight-semibold)" }}>
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
						<Typography variant="caption" sx={{ color: "text.disabled", fontSize: "var(--font-size-xs)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "var(--font-weight-semibold)" }}>
							Cost
						</Typography>
						<Box sx={{ mt: 0.5, mb: 2, p: 1.5, bgcolor: "background.default", borderRadius: "var(--radius-sm)", border: "1px solid", borderColor: "divider" }}>
							<DetailRow label="Estimated" value={`$${event.estimatedCost.toFixed(4)}`} />
						</Box>
					</>
				)}

				{event.responseJson && (
					<>
						<Typography variant="caption" sx={{ color: "text.disabled", fontSize: "var(--font-size-xs)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "var(--font-weight-semibold)" }}>
							AI Response
						</Typography>
						<Box sx={{ mt: 0.5, mb: 2, p: 1.5, bgcolor: "background.default", borderRadius: "var(--radius-sm)", border: "1px solid", borderColor: "divider" }}>
							<Typography variant="body2" component="pre" sx={{ fontSize: "var(--font-size-xs)", fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap", wordBreak: "break-word", m: 0 }}>
								{event.responseJson}
							</Typography>
						</Box>
					</>
				)}

				{isError && event.errorMessage && (
					<>
						<Typography variant="caption" sx={{ color: "text.disabled", fontSize: "var(--font-size-xs)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "var(--font-weight-semibold)" }}>
							Error
						</Typography>
						<Box sx={{ mt: 0.5, mb: 2, p: 1.5, bgcolor: "error.main", color: "error.contrastText", borderRadius: "var(--radius-sm)", border: "1px solid", borderColor: "error.dark" }}>
							<Typography variant="body2" sx={{ fontSize: "var(--font-size-sm)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
								{event.errorMessage}
							</Typography>
						</Box>
					</>
				)}

				<Divider sx={{ my: 1.5 }} />

				<Typography variant="caption" sx={{ color: "text.disabled", fontSize: "var(--font-size-xs)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "var(--font-weight-semibold)" }}>
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