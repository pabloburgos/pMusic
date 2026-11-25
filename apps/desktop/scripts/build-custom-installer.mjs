import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(desktopRoot, 'package.json'), 'utf-8'));
const version = pkg.version || '0.19.0';

const outDirArg = process.argv[2] || 'release';
const releaseDir = resolve(desktopRoot, outDirArg);
const unpackedDir = resolve(releaseDir, 'win-unpacked');
const workDir = resolve(releaseDir, '_custom_installer_work');
const payloadZip = resolve(workDir, 'payload.zip');
const csPath = resolve(workDir, 'PMusicInstaller.cs');
const outExe = resolve(releaseDir, 'pMusic-Setup.exe');
const iconIco = resolve(desktopRoot, 'build/icon.ico');
const iconPng = resolve(desktopRoot, 'build/icon.png');

if (!existsSync(unpackedDir)) {
  throw new Error(`Missing unpacked Electron directory: ${unpackedDir}`);
}
mkdirSync(workDir, { recursive: true });

if (existsSync(payloadZip)) rmSync(payloadZip, { force: true });
console.log('Packing pMusic payload.zip...');
execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-Command',
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${unpackedDir.replace(/'/g, "''")}', '${payloadZip.replace(/'/g, "''")}', [System.IO.Compression.CompressionLevel]::Fastest, $false)`,
  ],
  { stdio: 'inherit' }
);

const csSource = `using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

namespace PMusicSetup {
  public class ModernPMusicInstaller : Form {
    private const int WM_NCLBUTTONDOWN = 0xA1;
    private const int HT_CAPTION = 0x2;

    [DllImport("user32.dll")]
    private static extern int SendMessage(IntPtr hWnd, int Msg, int wParam, int lParam);
    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    private Image logoImg;
    private TextBox pathBox;
    private CheckBox desktopCheck;
    private Button installBtn;
    private Button browseBtn;
    private Label statusLabel;
    private Label pctLabel;
    private Panel progressTrack;
    private float progressValue = 0f;
    private bool installing = false;
    private bool installed = false;
    private string installedExePath = "";

    public ModernPMusicInstaller() {
      this.FormBorderStyle = FormBorderStyle.None;
      this.StartPosition = FormStartPosition.CenterScreen;
      this.ClientSize = new Size(540, 396);
      this.BackColor = Color.FromArgb(6, 6, 10);
      this.DoubleBuffered = true;
      this.Text = "pMusic";

      try {
        using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("pMusic.icon.png")) {
          if (s != null) logoImg = Image.FromStream(s);
        }
      } catch {}

      try {
        this.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
      } catch {}

      this.Region = CreateRoundedRegion(this.ClientSize.Width, this.ClientSize.Height, 26);
      this.MouseDown += (s, e) => {
        if (e.Button == MouseButtons.Left) {
          ReleaseCapture();
          SendMessage(this.Handle, WM_NCLBUTTONDOWN, HT_CAPTION, 0);
        }
      };

      BuildUi();
    }

    private static Region CreateRoundedRegion(int w, int h, int r) {
      GraphicsPath path = new GraphicsPath();
      int d = r * 2;
      path.AddArc(0, 0, d, d, 180, 90);
      path.AddArc(w - d, 0, d, d, 270, 90);
      path.AddArc(w - d, h - d, d, d, 0, 90);
      path.AddArc(0, h - d, d, d, 90, 90);
      path.CloseFigure();
      return new Region(path);
    }

    private void BuildUi() {
      Button closeBtn = new Button {
        Text = "✕",
        ForeColor = Color.FromArgb(185, 185, 200),
        BackColor = Color.FromArgb(20, 20, 28),
        FlatStyle = FlatStyle.Flat,
        Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
        Size = new Size(34, 34),
        Location = new Point(this.ClientSize.Width - 50, 16),
        Cursor = Cursors.Hand,
        TabStop = false
      };
      closeBtn.FlatAppearance.BorderColor = Color.FromArgb(42, 42, 56);
      closeBtn.FlatAppearance.BorderSize = 1;
      closeBtn.Region = CreateRoundedRegion(34, 34, 17);
      closeBtn.Click += (s, e) => { if (!installing) this.Close(); };
      this.Controls.Add(closeBtn);

      Label subtitleLabel = new Label {
        Text = "Tu música, sin límites.",
        ForeColor = Color.FromArgb(164, 164, 184),
        BackColor = Color.Transparent,
        Font = new Font("Segoe UI", 9.8f, FontStyle.Regular),
        TextAlign = ContentAlignment.MiddleCenter,
        Location = new Point(40, 172),
        Size = new Size(this.ClientSize.Width - 80, 22)
      };
      this.Controls.Add(subtitleLabel);

      string defaultDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Programs",
        "pmusic"
      );

      Label folderLbl = new Label {
        Text = "CARPETA DE INSTALACIÓN",
        ForeColor = Color.FromArgb(120, 122, 142),
        BackColor = Color.Transparent,
        Font = new Font("Segoe UI", 7.6f, FontStyle.Bold),
        Location = new Point(42, 208),
        AutoSize = true
      };
      this.Controls.Add(folderLbl);

      pathBox = new TextBox {
        Text = defaultDir,
        ForeColor = Color.FromArgb(232, 232, 242),
        BackColor = Color.FromArgb(16, 16, 23),
        BorderStyle = BorderStyle.FixedSingle,
        Font = new Font("Segoe UI", 9.5f),
        Location = new Point(42, 226),
        Size = new Size(404, 28)
      };
      this.Controls.Add(pathBox);

      browseBtn = new Button {
        Text = "...",
        ForeColor = Color.FromArgb(215, 215, 228),
        BackColor = Color.FromArgb(24, 24, 33),
        FlatStyle = FlatStyle.Flat,
        Font = new Font("Segoe UI", 9.2f, FontStyle.Bold),
        Location = new Point(452, 225),
        Size = new Size(46, 28),
        Cursor = Cursors.Hand
      };
      browseBtn.FlatAppearance.BorderColor = Color.FromArgb(46, 46, 62);
      browseBtn.FlatAppearance.BorderSize = 1;
      browseBtn.Click += (s, e) => {
        using (FolderBrowserDialog fbd = new FolderBrowserDialog()) {
          fbd.SelectedPath = pathBox.Text;
          if (fbd.ShowDialog() == DialogResult.OK && !string.IsNullOrWhiteSpace(fbd.SelectedPath)) {
            pathBox.Text = fbd.SelectedPath;
          }
        }
      };
      this.Controls.Add(browseBtn);

      desktopCheck = new CheckBox {
        Text = "Crear acceso directo en el Escritorio",
        Checked = true,
        ForeColor = Color.FromArgb(170, 172, 190),
        BackColor = Color.Transparent,
        Font = new Font("Segoe UI", 9f),
        Location = new Point(42, 264),
        AutoSize = true,
        Cursor = Cursors.Hand
      };
      this.Controls.Add(desktopCheck);

      progressTrack = new Panel {
        Location = new Point(42, 300),
        Size = new Size(456, 7),
        BackColor = Color.FromArgb(24, 24, 34)
      };
      progressTrack.Region = CreateRoundedRegion(456, 7, 3);
      progressTrack.Paint += (s, e) => {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        int fillW = (int)(progressTrack.Width * Math.Max(0f, Math.Min(1f, progressValue)));
        if (fillW > 0) {
          using (LinearGradientBrush br = new LinearGradientBrush(
            new Rectangle(0, 0, Math.Max(2, fillW), progressTrack.Height),
            Color.FromArgb(196, 152, 255),
            Color.White,
            0f
          )) {
            e.Graphics.FillRectangle(br, 0, 0, fillW, progressTrack.Height);
          }
        }
      };
      this.Controls.Add(progressTrack);

      statusLabel = new Label {
        Text = "Listo para instalar pMusic en este equipo",
        ForeColor = Color.FromArgb(145, 148, 166),
        BackColor = Color.Transparent,
        Font = new Font("Segoe UI", 8.6f),
        Location = new Point(42, 314),
        Size = new Size(220, 20)
      };
      this.Controls.Add(statusLabel);

      pctLabel = new Label {
        Text = "",
        ForeColor = Color.FromArgb(220, 220, 236),
        BackColor = Color.Transparent,
        Font = new Font("Segoe UI", 8.8f, FontStyle.Bold),
        TextAlign = ContentAlignment.MiddleRight,
        Location = new Point(220, 314),
        Size = new Size(68, 20)
      };
      this.Controls.Add(pctLabel);

      installBtn = new Button {
        Text = "Instalar pMusic",
        ForeColor = Color.FromArgb(8, 8, 12),
        BackColor = Color.White,
        FlatStyle = FlatStyle.Flat,
        Font = new Font("Segoe UI", 10.2f, FontStyle.Bold),
        Location = new Point(316, 326),
        Size = new Size(182, 44),
        Cursor = Cursors.Hand
      };
      installBtn.FlatAppearance.BorderSize = 0;
      installBtn.Region = CreateRoundedRegion(182, 44, 22);
      installBtn.Click += async (s, e) => {
        if (installed) {
          try {
            if (File.Exists(installedExePath)) {
              Process.Start(new ProcessStartInfo(installedExePath) { UseShellExecute = true });
            }
          } catch {}
          this.Close();
          return;
        }
        await RunInstallationAsync();
      };
      this.Controls.Add(installBtn);
    }

    protected override void OnPaint(PaintEventArgs e) {
      base.OnPaint(e);
      Graphics g = e.Graphics;
      g.SmoothingMode = SmoothingMode.AntiAlias;
      g.InterpolationMode = InterpolationMode.HighQualityBicubic;

      g.Clear(Color.FromArgb(6, 6, 10));

      // Subtle pMusic violet/indigo atmospheric aura at the top
      using (GraphicsPath gp = new GraphicsPath()) {
        gp.AddEllipse(80, -120, 380, 280);
        using (PathGradientBrush glow = new PathGradientBrush(gp)) {
          glow.CenterColor = Color.FromArgb(46, 168, 118, 255);
          glow.SurroundColors = new Color[] { Color.Transparent };
          g.FillPath(glow, gp);
        }
      }

      // Clean rounded hairline glass frame
      using (GraphicsPath borderPath = new GraphicsPath()) {
        int w = this.ClientSize.Width - 2;
        int h = this.ClientSize.Height - 2;
        int d = 50;
        borderPath.AddArc(1, 1, d, d, 180, 90);
        borderPath.AddArc(w - d, 1, d, d, 270, 90);
        borderPath.AddArc(w - d, h - d, d, d, 0, 90);
        borderPath.AddArc(1, h - d, d, d, 90, 90);
        borderPath.CloseFigure();
        using (Pen borderPen = new Pen(Color.FromArgb(42, 255, 255, 255), 1.4f)) {
          g.DrawPath(borderPen, borderPath);
        }
      }

      // Centered pMusic squircle icon
      if (logoImg != null) {
        g.DrawImage(logoImg, (this.ClientSize.Width - 82) / 2, 36, 82, 82);
      }

      // Clean "pMusic" wordmark without version clutter
      using (Font titleFont = new Font("Segoe UI", 22f, FontStyle.Bold))
      using (Brush whiteBrush = new SolidBrush(Color.White))
      using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center }) {
        g.DrawString("pMusic", titleFont, whiteBrush, this.ClientSize.Width / 2f, 128, sf);
      }
    }

    private void SetProgress(float p, string status, string pctText) {
      if (this.InvokeRequired) {
        this.BeginInvoke(new Action(() => SetProgress(p, status, pctText)));
        return;
      }
      progressValue = p;
      statusLabel.Text = status;
      pctLabel.Text = pctText;
      progressTrack.Invalidate();
    }

    private async Task RunInstallationAsync() {
      string targetDir = pathBox.Text.Trim();
      if (string.IsNullOrEmpty(targetDir)) return;

      installing = true;
      installBtn.Enabled = false;
      browseBtn.Enabled = false;
      pathBox.Enabled = false;
      desktopCheck.Enabled = false;
      installBtn.Text = "Instalando...";

      try {
        await Task.Run(() => {
          SetProgress(0.05f, "Preparando archivos...", "5%");
          Directory.CreateDirectory(targetDir);

          try {
            foreach (Process proc in Process.GetProcessesByName("pmusic")) {
              try { proc.Kill(); proc.WaitForExit(3000); } catch {}
            }
          } catch {}

          using (Stream resStream = Assembly.GetExecutingAssembly().GetManifestResourceStream("pMusic.payload.zip")) {
            if (resStream == null) throw new Exception("Paquete interno no encontrado.");
            using (ZipArchive archive = new ZipArchive(resStream, ZipArchiveMode.Read)) {
              int total = Math.Max(1, archive.Entries.Count);
              int done = 0;
              foreach (ZipArchiveEntry entry in archive.Entries) {
                string destPath = Path.GetFullPath(Path.Combine(targetDir, entry.FullName));
                if (!destPath.StartsWith(Path.GetFullPath(targetDir), StringComparison.OrdinalIgnoreCase)) continue;
                if (string.IsNullOrEmpty(entry.Name)) {
                  Directory.CreateDirectory(destPath);
                } else {
                  Directory.CreateDirectory(Path.GetDirectoryName(destPath));
                  entry.ExtractToFile(destPath, true);
                }
                done++;
                if (done % 6 == 0 || done == total) {
                  float ratio = 0.08f + 0.84f * ((float)done / total);
                  SetProgress(ratio, "Instalando pMusic...", string.Format("{0}%", (int)(ratio * 100)));
                }
              }
            }
          }

          string exePath = Path.Combine(targetDir, "pmusic.exe");
          installedExePath = exePath;

          SetProgress(0.95f, "Configurando accesos directos...", "95%");
          RegisterProtocol(exePath);
          RegisterUninstallEntry(targetDir, exePath);
          CreateShortcut(
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "pMusic.lnk"),
            exePath,
            targetDir
          );
          if (desktopCheck.Checked) {
            CreateShortcut(
              Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "pMusic.lnk"),
              exePath,
              targetDir
            );
          }
          SetProgress(1.0f, "¡Listo! pMusic instalado", "100%");
        });

        installed = true;
        installBtn.Text = "Abrir pMusic";
        installBtn.Enabled = true;
      } catch (Exception ex) {
        SetProgress(0f, ex.Message, "Error");
        installBtn.Text = "Reintentar";
        installBtn.Enabled = true;
        browseBtn.Enabled = true;
        pathBox.Enabled = true;
        desktopCheck.Enabled = true;
      } finally {
        installing = false;
      }
    }

    private static void RegisterProtocol(string exePath) {
      try {
        using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\\Classes\\pmusic")) {
          if (key != null) {
            key.SetValue("", "URL:pMusic Protocol");
            key.SetValue("URL Protocol", "");
            using (RegistryKey cmd = key.CreateSubKey(@"shell\\open\\command")) {
              if (cmd != null) cmd.SetValue("", "\\"" + exePath + "\\" \\"%1\\"");
            }
          }
        }
      } catch {}
    }

    private static void RegisterUninstallEntry(string targetDir, string exePath) {
      try {
        using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\pMusic")) {
          if (key != null) {
            key.SetValue("DisplayName", "pMusic");
            key.SetValue("DisplayIcon", exePath + ",0");
            key.SetValue("InstallLocation", targetDir);
            key.SetValue("Publisher", "pMusic");
            key.SetValue("NoModify", 1, RegistryValueKind.DWord);
            key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
          }
        }
      } catch {}
    }

    private static void CreateShortcut(string shortcutPath, string targetExe, string workingDir) {
      try {
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType == null) return;
        dynamic shell = Activator.CreateInstance(shellType);
        dynamic shortcut = shell.CreateShortcut(shortcutPath);
        shortcut.TargetPath = targetExe;
        shortcut.WorkingDirectory = workingDir;
        shortcut.IconLocation = targetExe + ",0";
        shortcut.Description = "pMusic";
        shortcut.Save();
      } catch {}
    }

    [STAThread]
    public static void Main() {
      Application.EnableVisualStyles();
      Application.SetCompatibleTextRenderingDefault(false);
      Application.Run(new ModernPMusicInstaller());
    }
  }
}
`;

writeFileSync(csPath, csSource, 'utf-8');

const cscPath = 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe';
console.log(`Compiling modern versionless pMusic installer (app ${version})...`);
execFileSync(
  cscPath,
  [
    '/nologo',
    '/target:winexe',
    '/optimize+',
    `/out:${outExe}`,
    `/win32icon:${iconIco}`,
    `/resource:${payloadZip},pMusic.payload.zip`,
    `/resource:${iconPng},pMusic.icon.png`,
    '/r:System.Windows.Forms.dll',
    '/r:System.Drawing.dll',
    '/r:System.IO.Compression.dll',
    '/r:System.IO.Compression.FileSystem.dll',
    '/r:Microsoft.CSharp.dll',
    csPath,
  ],
  { stdio: 'inherit' }
);

rmSync(workDir, { recursive: true, force: true });
console.log(`CUSTOM_INSTALLER_READY: ${outExe} (${statSync(outExe).size} bytes)`);
