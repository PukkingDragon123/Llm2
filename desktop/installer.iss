; Inno Setup script - Windows installer for Prolog Titanium Estimator
#define AppVersion GetEnv("APP_VERSION")
[Setup]
AppId={{6C4B0E7A-3F1D-4C55-9C2B-PROLOGEST001}
AppName=Prolog Titanium Estimator
AppVersion={#AppVersion}
AppPublisher=Prolog Titanium Corporation Co.,Ltd.
DefaultDirName={autopf}\Prolog Titanium Estimator
DefaultGroupName=Prolog Titanium Estimator
OutputBaseFilename=PrologEstimator-Setup-{#AppVersion}
SetupIconFile=icon.ico
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=lowest
ArchitecturesInstallIn64BitMode=x64compatible
[Files]
Source: "..\dist\PrologEstimator\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion
[Icons]
Name: "{group}\Prolog Titanium Estimator"; Filename: "{app}\PrologEstimator.exe"
Name: "{autodesktop}\Prolog Titanium Estimator"; Filename: "{app}\PrologEstimator.exe"; Tasks: desktopicon
[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"
[Run]
Filename: "{app}\PrologEstimator.exe"; Description: "Start Prolog Titanium Estimator"; Flags: nowait postinstall skipifsilent
