"""Tests for SettingsRepo — single source of truth for HQ-mode flags and onboarding."""
import pytest
from app import db
from app.settings import SettingsRepo


@pytest.fixture
def conn(tmp_path):
    db.init(tmp_path / "data.db")
    c = db.get_connection(tmp_path / "data.db")
    yield c
    c.close()


def test_get_hq_config_defaults_all_off(conn):
    repo = SettingsRepo(conn)
    cfg = repo.get_hq_config()
    assert cfg == {
        "hq_mode": False,
        "hq_orientation": False,
        "hq_unwarping": False,
        "hq_textline": False,
        "hq_chart": False,
        "hq_seal": False,
    }


def test_set_hq_config_persists(conn):
    repo = SettingsRepo(conn)
    new_cfg = {
        "hq_mode": True,
        "hq_orientation": True,
        "hq_unwarping": True,
        "hq_textline": False,
        "hq_chart": False,
        "hq_seal": False,
    }
    repo.set_hq_config(new_cfg)
    assert repo.get_hq_config() == new_cfg


def test_set_hq_config_partial_update(conn):
    repo = SettingsRepo(conn)
    repo.set_hq_config({"hq_orientation": True})
    cfg = repo.get_hq_config()
    assert cfg["hq_orientation"] is True
    assert cfg["hq_unwarping"] is False  # untouched key remains False


def test_set_hq_config_rejects_unknown_key(conn):
    repo = SettingsRepo(conn)
    with pytest.raises(ValueError, match="unknown setting key"):
        repo.set_hq_config({"hq_evil": True})


def test_onboarding_seen_default_fresh(conn):
    repo = SettingsRepo(conn)
    assert repo.is_onboarding_seen() is False


def test_mark_onboarding_seen(conn):
    repo = SettingsRepo(conn)
    repo.mark_onboarding_seen()
    assert repo.is_onboarding_seen() is True
