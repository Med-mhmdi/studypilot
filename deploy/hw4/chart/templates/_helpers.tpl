{{- define "hw4.name" -}}
{{- printf "%s-app" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "hw4.selector" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "hw4.labels" -}}
{{ include "hw4.selector" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}
