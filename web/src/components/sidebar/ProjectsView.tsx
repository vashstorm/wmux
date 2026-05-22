import { useState, useEffect, useCallback } from "react";
import { Box, Typography, IconButton, TextField, Button, List, ListItem, ListItemText, Stack, Collapse, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, FormControlLabel, Checkbox } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import CloseIcon from "@mui/icons-material/Close";
import { useAppState } from "../../state/store.js";
import { listProjects, createProject, updateProject, deleteProject, getProject } from "../../api/client.js";
import type { Project, NewProject } from "../../api/client.js";
import { ApiError } from "../../api/errors.js";

export function ProjectsView() {
	const { selectedProject, setSelectedProject } = useAppState();
	const [projects, setProjects] = useState<Project[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [showForm, setShowForm] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [formName, setFormName] = useState("");
	const [formPath, setFormPath] = useState("");
	const [formDescription, setFormDescription] = useState("");

	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
	const [killSessionCheckbox, setKillSessionCheckbox] = useState(false);

	const loadProjects = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const data = await listProjects();
			setProjects(data);
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Failed to load projects");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => { loadProjects(); }, [loadProjects]);

	const resetForm = () => {
		setFormName("");
		setFormPath("");
		setFormDescription("");
		setShowForm(false);
		setEditingId(null);
	};

	const handleSelect = (project: Project) => {
		if (selectedProject?.id === project.id) {
			setSelectedProject(null);
			return;
		}
		setSelectedProject(project);
	};

	const handleCreate = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!formName.trim()) return;
		setError(null);
		try {
			const created = await createProject({ name: formName.trim(), path: formPath.trim(), description: formDescription.trim() });
			resetForm();
			await loadProjects();
			setSelectedProject(created);
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Failed to create project");
		}
	};

	const handleUpdate = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!editingId) return;
		setError(null);
		try {
			await updateProject(editingId, { name: formName.trim() || undefined, path: formPath.trim(), description: formDescription.trim() });
			await refreshSelectedProject(editingId);
			resetForm();
			await loadProjects();
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Failed to update project");
		}
	};

	const handleDeleteClick = (project: Project) => {
		setProjectToDelete(project);
		setKillSessionCheckbox(false);
		setDeleteDialogOpen(true);
	};

	const handleConfirmDelete = async () => {
		if (!projectToDelete) return;
		setError(null);
		try {
			await deleteProject(projectToDelete.id, killSessionCheckbox);
			if (selectedProject?.id === projectToDelete.id) {
				setSelectedProject(null);
			}
			await loadProjects();
			setDeleteDialogOpen(false);
			setProjectToDelete(null);
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Failed to delete project");
			setDeleteDialogOpen(false);
			setProjectToDelete(null);
		}
	};

	const refreshSelectedProject = useCallback(async (id: string) => {
		if (!selectedProject || selectedProject.id !== id) return;
		try {
			const updated = await getProject(id);
			setSelectedProject(updated);
		} catch {
			// stale reads are acceptable
		}
	}, [selectedProject, setSelectedProject]);

	const startEdit = (project: Project) => {
		setEditingId(project.id);
		setFormName(project.name);
		setFormPath(project.path);
		setFormDescription(project.description);
		setShowForm(true);
	};

	return (
		<Box data-testid="projects-view" sx={{ minHeight: 1 }}>
			<Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}>
				<Typography variant="subtitle2" sx={{ fontSize: "var(--font-size-sm)", fontWeight: "var(--font-weight-semibold)" }}>
					Projects
				</Typography>
				<IconButton size="small" onClick={() => { resetForm(); setShowForm(!showForm); }} data-testid="projects-add-button" aria-label="Add project">
					{showForm ? <CloseIcon fontSize="small" /> : <AddIcon fontSize="small" />}
				</IconButton>
			</Stack>

			<Collapse in={showForm} timeout={200} unmountOnExit>
				<Box component="form" onSubmit={editingId ? handleUpdate : handleCreate} data-testid="project-form" sx={{ mb: 1, p: 1, bgcolor: "background.default", borderRadius: "var(--radius-sm)", border: "1px solid", borderColor: "divider" }}>
					<TextField size="small" fullWidth placeholder="Project name" value={formName} onChange={(e) => setFormName(e.target.value)} data-testid="project-name-input" sx={{ mb: 0.5 }} />
					<TextField size="small" fullWidth placeholder="Path (optional)" value={formPath} onChange={(e) => setFormPath(e.target.value)} data-testid="project-path-input" sx={{ mb: 0.5 }} />
					<TextField size="small" fullWidth placeholder="Description (optional)" value={formDescription} onChange={(e) => setFormDescription(e.target.value)} data-testid="project-description-input" sx={{ mb: 0.5 }} />
					<Stack direction="row" spacing={0.5}>
						<Button type="submit" size="small" variant="contained" data-testid="project-submit-button">{editingId ? "Update" : "Create"}</Button>
						<Button size="small" onClick={resetForm}>Cancel</Button>
					</Stack>
				</Box>
			</Collapse>

			{error && (
				<Typography color="error" variant="caption" data-testid="projects-error" sx={{ display: "block", mb: 1 }}>
					{error}
				</Typography>
			)}

			{loading && projects.length === 0 ? (
				<Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", py: 2 }}>Loading...</Typography>
			) : projects.length === 0 ? (
				<Typography variant="body2" color="text.secondary" data-testid="projects-empty" sx={{ textAlign: "center", py: 2 }}>No projects yet</Typography>
			) : (
				<List disablePadding dense>
					{projects.map((project) => (
						<ListItem
							key={project.id}
							data-testid={`project-item-${project.id}`}
							onClick={() => handleSelect(project)}
							sx={{
								px: 1,
								py: 0.5,
								borderRadius: "var(--radius-sm)",
								cursor: "pointer",
								bgcolor: selectedProject?.id === project.id ? "primary.main" : "transparent",
								color: selectedProject?.id === project.id ? "primary.contrastText" : "inherit",
								"&:hover": { bgcolor: selectedProject?.id === project.id ? "primary.dark" : "action.hover" },
								borderLeft: selectedProject?.id === project.id ? "3px solid" : "3px solid transparent",
								borderColor: selectedProject?.id === project.id ? "primary.light" : "transparent",
							}}
							secondaryAction={
								<Stack direction="row" spacing={0.25}>
									<IconButton size="small" onClick={(e) => { e.stopPropagation(); startEdit(project); }} data-testid={`project-edit-${project.id}`} aria-label="Edit"><EditIcon fontSize="small" /></IconButton>
									<IconButton size="small" onClick={(e) => { e.stopPropagation(); handleDeleteClick(project); }} data-testid={`project-delete-${project.id}`} aria-label="Delete"><DeleteIcon fontSize="small" /></IconButton>
								</Stack>
							}
						>
							<ListItemText
							primary={project.name}
							secondary={project.path || project.description || undefined}
						/>
						</ListItem>
					))}
				</List>
			)}

			<Dialog
				open={deleteDialogOpen}
				onClose={() => setDeleteDialogOpen(false)}
				slotProps={{
					paper: {
						sx: {
							bgcolor: "background.paper",
							backgroundImage: "none",
							borderRadius: "var(--radius-md)",
							border: "1px solid",
							borderColor: "divider",
							p: 1.5,
							minWidth: 320,
						}
					}
				}}
				data-testid="delete-project-dialog"
			>
				<DialogTitle sx={{ p: 0, mb: 1, fontSize: "var(--font-size-base)", fontWeight: "var(--font-weight-semibold)" }}>
					Delete Project
				</DialogTitle>
				<DialogContent sx={{ p: 0, mb: 2 }}>
					<DialogContentText sx={{ fontSize: "var(--font-size-sm)", color: "text.secondary", mb: 2 }}>
						Are you sure you want to delete project <strong>{projectToDelete?.name}</strong>? This action cannot be undone.
					</DialogContentText>
					{projectToDelete?.sessionName && (
						<FormControlLabel
							control={
								<Checkbox
									checked={killSessionCheckbox}
									onChange={(e) => setKillSessionCheckbox(e.target.checked)}
									size="small"
									sx={{
										color: "primary.main",
										"&.Mui-checked": {
											color: "primary.main",
										},
									}}
									data-testid="kill-session-checkbox"
								/>
							}
							label={
								<Typography variant="body2" sx={{ fontSize: "var(--font-size-sm)" }}>
									Also terminate active tmux session <code>{projectToDelete.sessionName}</code>
								</Typography>
							}
						/>
					)}
				</DialogContent>
				<DialogActions sx={{ p: 0, justifyContent: "flex-end", gap: 1 }}>
					<Button
						onClick={() => setDeleteDialogOpen(false)}
						size="small"
						sx={{
							textTransform: "none",
							fontWeight: "var(--font-weight-medium)",
							color: "text.secondary",
							"&:hover": {
								bgcolor: "action.hover",
							}
						}}
					>
						Cancel
					</Button>
					<Button
						onClick={handleConfirmDelete}
						variant="contained"
						color="error"
						size="small"
						sx={{
							textTransform: "none",
							fontWeight: "var(--font-weight-semibold)",
							boxShadow: "none",
							"&:hover": {
								boxShadow: "none",
								bgcolor: "error.dark",
							}
						}}
						data-testid="confirm-delete-button"
					>
						Delete
					</Button>
				</DialogActions>
			</Dialog>
		</Box>
	);
}
